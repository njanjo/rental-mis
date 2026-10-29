import "server-only";

/**
 * Beam SMS pipeline.
 *
 * enqueue → worker (Beam send) → poll (delivery status). Every stage is
 * idempotent and nothing here throws on provider trouble: SMS is a
 * notification channel, so a Beam outage must never abort a payment or a
 * reminder run.
 *
 * Idempotency: reminder messages carry a `campaignId` like
 * `rent_due_reminder:inv_<id>:due_soon`; enqueue checks that key first, so a
 * retried cron run can never send the same message twice.
 */

import {
  FieldValue,
  Timestamp,
  WithFieldValue,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import { writeAuditLog } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { toDateInput, toIsoString } from "@/lib/dates";
import { ServiceError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import {
  DEFAULT_SMS_TEMPLATES,
  beamMessageIdFromSend,
  beamSendPayload,
  defaultSmsVariables,
  renderSmsBody,
  reportsFromBeamList,
  smsBackoffMinutes,
} from "@/lib/sms";
import type {
  Invoice,
  Role,
  SmsOutboxItem,
  SmsStatus,
  SmsTemplateKey,
  SystemSettings,
  Tenant,
} from "@/lib/types";

const OUTBOX = "smsOutbox";
const SMS_LOGS = "smsLogs";
const TENANTS = "tenants";
const SETTINGS = "systemSettings";
const INVOICES = "invoices";

/** One worker pass sends at most this many messages; cron re-runs drain more. */
export const SEND_BATCH = 25;

/** Give up on a message after this many Beam attempts (dead-letter). */
export const MAX_SEND_ATTEMPTS = 5;

/** Reminder scan reads at most this many live invoices per run. */
const REMINDER_SCAN_LIMIT = 200;

export interface SendOutcome {
  sent: number;
  retried: number;
  dead: number;
}

/** Beam credentials; absent config aborts worker runs before anything sends. */
export function assertBeamConfig(): {
  baseUrl: string;
  token: string;
  senderId: string;
} {
  const token = process.env.BEAM_SMS_API_KEY?.trim();
  const senderId = process.env.BEAM_SMS_SENDER_ID?.trim();
  if (!token || !senderId) {
    throw new ServiceError(
      "validation",
      "Beam SMS is not configured. Add BEAM_SMS_API_KEY and BEAM_SMS_SENDER_ID.",
    );
  }
  const baseUrl =
    process.env.BEAM_SMS_BASE_URL?.trim() ||
    "https://bulksms.beamnetworks.co.ke/api/v3";
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token, senderId };
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueueSmsInput {
  phoneE164: string;
  templateKey: SmsTemplateKey;
  reference: string;
  tenantName?: string;
  dateInput: string;
  moneyMinor?: number;
  dueDate?: string;
  balanceMinor?: number;
  campaignId?: string;
  requestedBy: string;
}

export function buildOutboxDoc(
  input: EnqueueSmsInput,
): WithFieldValue<Omit<SmsOutboxItem, "id">> {
  // lease_expiry / bulk_announcement templates are not defined yet.
  const templates = DEFAULT_SMS_TEMPLATES as Partial<
    Record<SmsTemplateKey, string>
  >;
  const template = templates[input.templateKey];
  if (!template) {
    throw new ServiceError(
      "validation",
      "That SMS template is not available yet.",
    );
  }

  const variables = defaultSmsVariables(input.templateKey, input);
  return {
    phoneE164: input.phoneE164,
    templateKey: input.templateKey,
    variables,
    body: renderSmsBody(template, variables),
    status: "queued",
    attempts: 0,
    nextAttemptAt: FieldValue.serverTimestamp(),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    requestedBy: input.requestedBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Queue one message inside the caller's transaction, so a payment receipt is
 * committed atomically with its payment. Deliberately swallows template
 * errors: notifications must never break a money commit. Attempt failures
 * also cannot happen here — the actual Beam call happens later in the worker.
 */
export function enqueueSmsWithinTransaction(
  tx: Transaction,
  input: EnqueueSmsInput,
): void {
  try {
    tx.set(adminDb().collection(OUTBOX).doc(), buildOutboxDoc(input));
  } catch {
    // Notifications must never break payment commits.
  }
}

/** Skip when this exact notification was already queued (campaign dedupe). */
export async function enqueueReminderIfNew(
  input: EnqueueSmsInput,
): Promise<boolean> {
  try {
    const existing = await adminDb()
      .collection(OUTBOX)
      .where("campaignId", "==", input.campaignId as string)
      .limit(1)
      .get();
    if (!existing.empty) return false;

    await adminDb().collection(OUTBOX).doc().set(buildOutboxDoc(input));
    return true;
  } catch {
    // Whatever went wrong, err on the quiet side and report "not queued".
    return false;
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

function logRow(
  outboxId: string,
  status: SmsStatus,
  extras: {
    providerMessageId?: string;
    errorMessage?: string;
  } = {},
): Record<string, unknown> {
  return {
    outboxId,
    provider: "beam" as const,
    status,
    ...(extras.providerMessageId
      ? { providerMessageId: extras.providerMessageId }
      : {}),
    ...(extras.errorMessage ? { errorMessage: extras.errorMessage } : {}),
    createdAt: FieldValue.serverTimestamp(),
  };
}

type OutboxSnapshot = QueryDocumentSnapshot;

async function markAttempt(
  snapshot: OutboxSnapshot,
  result: { kind: "sent"; messageId?: string } | { kind: "failed"; errorMessage: string },
): Promise<void> {
  const db = adminDb();
  const ref = db.collection(OUTBOX).doc(snapshot.id);
  const attempts = ((snapshot.data() as SmsOutboxItem).attempts ?? 0) + 1;

  if (result.kind === "sent") {
    // Accepted by Beam even when the reply made no uid available; delivery
    // polling simply has nothing to key on until it shows up in the list.
    await db.runTransaction(async (tx) => {
      tx.update(ref, {
        status: "sent" satisfies SmsStatus,
        attempts,
        ...(result.messageId
          ? { providerMessageId: result.messageId }
          : {}),
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(
        db.collection(SMS_LOGS).doc(),
        logRow(snapshot.id, "sent", {
          providerMessageId: result.messageId,
        }),
      );
    });
    return;
  }

  const deadLetter = attempts >= MAX_SEND_ATTEMPTS;
  await ref.update({
    status: deadLetter ? ("dead_letter" satisfies SmsStatus) : "failed",
    attempts,
    lastError: result.errorMessage,
    ...(deadLetter
      ? {}
      : {
          nextAttemptAt: Timestamp.fromMillis(
            Date.now() + smsBackoffMinutes(attempts) * 60_000,
          ),
        }),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await adminDb()
    .collection(SMS_LOGS)
    .doc()
    .create(
      logRow(snapshot.id, "failed", { errorMessage: result.errorMessage }),
    );
}

async function sendOne(
  snapshot: OutboxSnapshot,
  config: { baseUrl: string; token: string; senderId: string },
  fetchImpl: typeof fetch,
): Promise<"sent" | "retried" | "dead"> {
  const item = snapshot.data() as SmsOutboxItem;
  const attempts = item.attempts + 1;

  try {
    const response = await fetchImpl(`${config.baseUrl}/sms/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(
        beamSendPayload(item.phoneE164, item.body, config.senderId),
      ),
    });

    const payload = (await response.json().catch(() => undefined)) as {
      message?: unknown;
    };

    if (!response.ok) {
      const detail =
        payload && typeof payload.message === "string" && payload.message.trim()
          ? payload.message
          : `Beam HTTP ${response.status}`;
      await markAttempt(snapshot, { kind: "failed", errorMessage: detail.slice(0, 200) });
      return attempts >= MAX_SEND_ATTEMPTS ? "dead" : "retried";
    }

    const messageId = beamMessageIdFromSend(payload);
    await markAttempt(snapshot, { kind: "sent", messageId });
    return "sent";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    await markAttempt(snapshot, { kind: "failed", errorMessage: message });
    return attempts >= MAX_SEND_ATTEMPTS ? "dead" : "retried";
  }
}

export function smsSystemActor(role: Role = "admin"): SessionUser {
  return {
    uid: "system:sms",
    email: "system@rentalmis.internal",
    fullName: "SMS automation",
    role,
    active: true,
    propertyIds: [],
  };
}

/**
 * Drain the outbox: send every queued/failed message whose backoff has
 * elapsed, oldest attempt first. `fetchImpl` is injectable so tests never
 * touch the network. Unconfigured Beam throws — the cron route answers 503.
 */
export async function runOutboxWorker(
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  const config = assertBeamConfig();
  const db = adminDb();

  const snapshot = await db
    .collection(OUTBOX)
    .where("status", "in", ["queued", "failed"])
    .where("nextAttemptAt", "<=", Timestamp.now())
    .orderBy("nextAttemptAt")
    .limit(SEND_BATCH)
    .get();

  const outcome: SendOutcome = { sent: 0, retried: 0, dead: 0 };

  await Promise.all(
    snapshot.docs.map(async (doc) => {
      const result = await sendOne(doc, config, fetchImpl);
      outcome[result] += 1;
    }),
  );

  if (snapshot.size > 0) {
    await db.runTransaction(async (tx) => {
      writeAuditLog(tx, {
        actorUid: "system:sms",
        actorRole: "admin",
        action: "sms.worker_ran",
        entityType: "smsOutbox",
        entityId: "batch",
        after: { ...outcome, scanned: snapshot.size },
      });
    });
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// Delivery polling
// ---------------------------------------------------------------------------

export interface PollOutcome {
  checkable: number;
  delivered: number;
  failed: number;
}

/**
 * Reconcile delivery reports for messages we handed to Beam but have not
 * confirmed yet. Beam has no webhook, so this polls the account message list
 * and matches Beam uids against `providerMessageId` on the outbox.
 */
export async function pollDeliveryReports(
  fetchImpl: typeof fetch = fetch,
): Promise<PollOutcome> {
  const config = assertBeamConfig();
  const db = adminDb();

  const sent = await db
    .collection(OUTBOX)
    .where("status", "==", "sent")
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get();

  const ids = sent.docs
    .map((doc) => (doc.data() as SmsOutboxItem).providerMessageId)
    .filter((id): id is string => Boolean(id));

  const outcome: PollOutcome = { checkable: ids.length, delivered: 0, failed: 0 };
  if (ids.length === 0) return outcome;

  const response = await fetchImpl(`${config.baseUrl}/sms`, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) return outcome;

  const reports = reportsFromBeamList(await response.json().catch(() => undefined));
  const byUid = new Map(reports.map((report) => [report.uid, report]));

  await Promise.all(
    sent.docs.map(async (doc) => {
      const item = doc.data() as SmsOutboxItem;
      if (!item.providerMessageId) return;

      const report = byUid.get(item.providerMessageId);
      if (!report?.status || report.status === item.status) return;

      outcome[report.status === "delivered" ? "delivered" : "failed"] += 1;

      await db.runTransaction(async (tx) => {
        tx.update(db.collection(OUTBOX).doc(doc.id), {
          status: report.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(
          db.collection(SMS_LOGS).doc(),
          logRow(doc.id, report.status as SmsStatus),
        );
      });
    }),
  );

  return outcome;
}

// ---------------------------------------------------------------------------
// Views (dashboard)
// ---------------------------------------------------------------------------

export interface SmsOutboxListItem {
  id: string;
  phoneE164: string;
  templateKey: SmsTemplateKey;
  status: SmsStatus;
  body: string;
  attempts: number;
  lastError?: string;
  campaignId?: string;
  requestedBy: string;
  updatedAt: string;
}

/** Recent outbox rows for the SMS dashboard, newest first. */
export async function listSmsOutbox(limit = 50): Promise<SmsOutboxListItem[]> {
  const db = adminDb();
  const snapshot = await db
    .collection(OUTBOX)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  if (snapshot.empty) return [];

  return snapshot.docs.map((doc) => {
    const item = doc.data() as SmsOutboxItem;
    return {
      id: doc.id,
      phoneE164: item.phoneE164,
      templateKey: item.templateKey,
      status: item.status,
      body: item.body,
      attempts: item.attempts ?? 0,
      ...(item.lastError ? { lastError: item.lastError } : {}),
      ...(item.campaignId ? { campaignId: item.campaignId } : {}),
      requestedBy: item.requestedBy,
      updatedAt: toIsoString((item.updatedAt as Timestamp) ?? null) ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------


export interface ReminderOutcome {
  dueSoon: number;
  overdue: number;
  skipped: number;
}

async function loadReminderCadence(): Promise<{
  dueSoonDaysBefore: number;
  overdueRepeatDays: number;
}> {
  const snapshot = await adminDb().collection(SETTINGS).doc("reminders").get();
  if (!snapshot.exists) {
    // Spec defaults: nudge 3 days before due, chase again weekly.
    return { dueSoonDaysBefore: 3, overdueRepeatDays: 7 };
  }
  const settings = snapshot.data() as SystemSettings;
  return {
    dueSoonDaysBefore: settings.reminders?.dueSoonDaysBefore ?? 3,
    overdueRepeatDays: settings.reminders?.overdueRepeatDays ?? 7,
  };
}

function reminderFacts(
  templateKey: "rent_due_reminder" | "arrears_notice",
  invoiceId: string,
  invoice: Invoice,
  tenant: Tenant,
): EnqueueSmsInput {
  const due = invoice.dueDate;
  const dueDate = due instanceof Timestamp ? due.toDate() : new Date(String(due));
  const dueIso = Number.isNaN(dueDate.getTime())
    ? undefined
    : dueDate.toISOString().slice(0, 10);

  return {
    phoneE164: tenant.phoneE164,
    templateKey,
    reference: invoiceId,
    tenantName: tenant.fullName.split(" ")[0],
    dateInput: toDateInput(new Date()),
    moneyMinor: invoice.balanceMinor,
    ...(dueIso ? { dueDate: dueIso } : {}),
    campaignId: undefined,
    requestedBy: "system:reminders",
  };
}

const UTC_DAY_MS = 86_400_000;

/** Whole calendar days between the instants, in UTC day buckets. */
function wholeDaysBetween(from: Date, to: Date): number {
  return (
    Math.floor(to.getTime() / UTC_DAY_MS) - Math.floor(from.getTime() / UTC_DAY_MS)
  );
}

/**
 * Generate rent reminders for active, consented tenants with live invoices:
 * one "rent due soon" message per invoice inside `dueSoonDaysBefore`, then an
 * arrears notice every `overdueRepeatDays` while it stays unpaid. Campaign ids
 * keep every run idempotent.
 */
export async function generateReminders(
  actor: SessionUser,
  today: Date = new Date(),
): Promise<ReminderOutcome> {
  const cadence = await loadReminderCadence();
  const outcome: ReminderOutcome = { dueSoon: 0, overdue: 0, skipped: 0 };
  if (cadence.dueSoonDaysBefore <= 0 && cadence.overdueRepeatDays <= 0) {
    return outcome;
  }

  const db = adminDb();
  const todayInput = today.toISOString().slice(0, 10);

  // Only live invoices need chasing; `paid` and `void` ones are skipped.
  // No composite index is needed: equality filters only, sorted in memory.
  const invoices = await db
    .collection(INVOICES)
    .where("status", "in", ["open", "partial"])
    .limit(REMINDER_SCAN_LIMIT)
    .get();

  for (const doc of invoices.docs) {
    const invoice = {
      ...(doc.data() as Invoice),
      // The document id is authoritative; `id` is not stored as a field.
      id: doc.id,
    };
    if (invoice.balanceMinor <= 0) {
      outcome.skipped += 1;
      continue;
    }

    const due = invoice.dueDate;
    const dueDate =
      due instanceof Timestamp ? due.toDate() : new Date(String(due));
    if (Number.isNaN(dueDate.getTime())) {
      outcome.skipped += 1;
      continue;
    }

    const daysToDue = wholeDaysBetween(today, dueDate);

    let templateKey: "rent_due_reminder" | "arrears_notice" | undefined;
    let campaignSuffix: string | undefined;

    if (daysToDue >= 0 && daysToDue <= cadence.dueSoonDaysBefore) {
      templateKey = "rent_due_reminder";
      campaignSuffix = "due_soon";
    } else if (
      daysToDue < 0 &&
      cadence.overdueRepeatDays > 0 &&
      Math.abs(daysToDue) % cadence.overdueRepeatDays === 0
    ) {
      templateKey = "arrears_notice";
      campaignSuffix = `overdue_${Math.abs(daysToDue)}`;
    }

    if (!templateKey || !campaignSuffix) {
      outcome.skipped += 1;
      continue;
    }

    const tenantSnapshot = await db.collection(TENANTS).doc(invoice.tenantId).get();
    if (!tenantSnapshot.exists) {
      outcome.skipped += 1;
      continue;
    }

    const tenant = tenantSnapshot.data() as Tenant;
    if (tenant.status !== "active" || tenant.consentSms !== true) {
      outcome.skipped += 1;
      continue;
    }

    const facts = reminderFacts(templateKey, doc.id, invoice, tenant);
    const queued = await enqueueReminderIfNew({
      ...facts,
      campaignId: `${templateKey}:${doc.id}:${campaignSuffix}`,
    });

    if (queued) {
      outcome[templateKey === "rent_due_reminder" ? "dueSoon" : "overdue"] += 1;
    } else {
      outcome.skipped += 1;
    }
  }

  if (invoices.size > 0) {
    await db.runTransaction(async (tx) => {
      writeAuditLog(tx, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "sms.reminders_generated",
        entityType: "smsOutbox",
        entityId: "batch",
        after: { ...outcome, scanned: invoices.size, date: todayInput },
      });
    });
  }

  return outcome;
}
