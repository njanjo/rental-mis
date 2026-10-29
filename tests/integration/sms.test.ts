import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { EnqueueSmsInput } from "@/services/sms";
import {
  assertBeamConfig,
  buildOutboxDoc,
  generateReminders,
  MAX_SEND_ATTEMPTS,
  pollDeliveryReports,
  runOutboxWorker,
} from "@/services/sms";

const db = () => adminDb();

const staff: SessionUser = {
  uid: "uid_admin",
  email: "admin@rentalmis.test",
  fullName: "Admin",
  role: "admin",
  active: true,
  propertyIds: [],
};

const ENV_KEYS = [
  "BEAM_SMS_API_KEY",
  "BEAM_SMS_SENDER_ID",
  "BEAM_SMS_BASE_URL",
  "CRON_SECRET",
] as const;

const envBackup = new Map<string, string | undefined>();

function sampleInput(overrides: Partial<EnqueueSmsInput> = {}): EnqueueSmsInput {
  return {
    phoneE164: "+254712345678",
    templateKey: "payment_receipt",
    reference: "RKT7DMQ6K8",
    tenantName: "Grace Wanjiru",
    dateInput: "2026-10-29",
    moneyMinor: 4_500_000,
    balanceMinor: 0,
    requestedBy: "uid_finance",
    ...overrides,
  };
}

async function seedTenant(options: {
  consentSms?: boolean;
  status?: "active" | "former";
} = {}): Promise<void> {
  await db()
    .collection("tenants")
    .doc("tnt_1")
    .set({
      fullName: "Grace Wanjiru",
      fullNameLower: "grace wanjiru",
      phoneE164: "+254712345678",
      status: options.status ?? "active",
      consentSms: options.consentSms ?? true,
      propertyIds: ["prop_1"],
      currentPropertyId: "prop_1",
      createdBy: "uid_admin",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function seedInvoice(dueDateIso: string): Promise<string> {
  const ref = db().collection("invoices").doc("inv_1");
  await ref.set({
    tenantId: "tnt_1",
    leaseId: "lease_1",
    unitId: "unit_1",
    propertyId: "prop_1",
    periodKey: "2026-10",
    dueDate: Timestamp.fromDate(new Date(dueDateIso)),
    amountDueMinor: 4_500_000,
    amountPaidMinor: 0,
    balanceMinor: 4_500_000,
    currency: "KES",
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function outboxDoc(campaignId?: string) {
  await db()
    .collection("smsOutbox")
    .doc("sms_test")
    .set(buildOutboxDoc(sampleInput({ campaignId })));
  return db().collection("smsOutbox").doc("sms_test");
}

interface StubRoute {
  send?: {
    status?: number;
    body?: unknown;
  };
  list?: {
    status?: number;
    body?: unknown;
  };
}

function stubFetch(routes: StubRoute): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const route = url.endsWith("/sms") ? routes.list : routes.send;
    return new Response(JSON.stringify(route?.body ?? {}), {
      status: route?.status ?? 200,
    }) as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  const firestore = db();
  await Promise.all(
    [
      "smsOutbox",
      "smsLogs",
      "tenants",
      "invoices",
      "auditLogs",
      "users",
      "leases",
      "units",
      "properties",
    ].map(async (name) => {
      const snapshot = await firestore.collection(name).get();
      if (snapshot.empty) return;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }),
  );

  ENV_KEYS.forEach((key) => envBackup.set(key, process.env[key]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

afterAll(() => {
  ENV_KEYS.forEach((key) => {
    const value = envBackup.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

function enableBeam(): void {
  process.env.BEAM_SMS_API_KEY = "49|testtoken";
  process.env.BEAM_SMS_SENDER_ID = "RENTMIS";
  process.env.CRON_SECRET = "cron-secret-test-value-0000000000000001";
}

describe("assertBeamConfig", () => {
  it("demands a token and sender id", () => {
    expect(() => assertBeamConfig()).toThrow(/not configured/i);
    enableBeam();
    const config = assertBeamConfig();
    expect(config.senderId).toBe("RENTMIS");
    expect(config.baseUrl).toBe("https://bulksms.beamnetworks.co.ke/api/v3");
  });
});

describe("runOutboxWorker", () => {
  it("sends queued messages and records the provider id", async () => {
    enableBeam();
    await outboxDoc();

    const outcome = await runOutboxWorker(
      stubFetch({ send: { body: { status: "success", data: "uid_606812e63f78b" } } }),
    );

    expect(outcome).toEqual({ sent: 1, retried: 0, dead: 0 });

    const item = (await db().collection("smsOutbox").doc("sms_test").get()).data();
    expect(item).toMatchObject({
      status: "sent",
      attempts: 1,
      providerMessageId: "uid_606812e63f78b",
    });

    const logs = await db()
      .collection("smsLogs")
      .where("outboxId", "==", "sms_test")
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()).toMatchObject({ status: "sent" });

    const workerAudits = await db()
      .collection("auditLogs")
      .where("action", "==", "sms.worker_ran")
      .get();
    expect(workerAudits.size).toBe(1);
  });

  it("backs off and retries on provider failure", async () => {
    enableBeam();
    await outboxDoc();

    const outcome = await runOutboxWorker(
      stubFetch({ send: { status: 500, body: { status: "error", message: "nope" } } }),
    );

    expect(outcome).toEqual({ sent: 0, retried: 1, dead: 0 });

    const item = (await db().collection("smsOutbox").doc("sms_test").get()).data();
    expect(item).toMatchObject({ status: "failed", attempts: 1 });
    expect(item?.lastError).toContain("nope");
    // Backoff schedules the next attempt in the future.
    expect((item?.nextAttemptAt as Timestamp).toMillis()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("dead-letters after the final attempt", async () => {
    enableBeam();
    const ref = await outboxDoc();
    await ref.update({ attempts: MAX_SEND_ATTEMPTS - 1 });

    const outcome = await runOutboxWorker(
      stubFetch({ send: { status: 500 } }),
    );

    expect(outcome.dead).toBe(1);

    const item = (await ref.get()).data();
    expect(item).toMatchObject({ status: "dead_letter", attempts: MAX_SEND_ATTEMPTS });
  });

  it("has nothing to do when Beam is unconfigured", async () => {
    await outboxDoc();
    await expect(runOutboxWorker(stubFetch({}))).rejects.toMatchObject({
      code: "validation",
    });
  });
});

describe("pollDeliveryReports", () => {
  it("promotes sent messages to delivered", async () => {
    enableBeam();
    const ref = await outboxDoc();
    await ref.update({
      status: "sent",
      providerMessageId: "uid_606812e63f78b",
      attempts: 1,
      updatedAt: Timestamp.now(),
    });

    const outcome = await pollDeliveryReports(
      stubFetch({
        list: {
          body: {
            data: [{ uid: "uid_606812e63f78b", status: "Delivered" }],
          },
        },
      }),
    );

    expect(outcome).toEqual({ checkable: 1, delivered: 1, failed: 0 });

    const item = (await ref.get()).data();
    expect(item?.status).toBe("delivered");

    const logs = await db()
      .collection("smsLogs")
      .where("outboxId", "==", "sms_test")
      .where("status", "==", "delivered")
      .get();
    expect(logs.size).toBe(1);
  });

  it("stops quietly when nothing is sent yet", async () => {
    enableBeam();
    const outcome = await pollDeliveryReports(stubFetch({}));
    expect(outcome.checkable).toBe(0);
  });
});

describe("generateReminders", () => {
  it("queues one due-soon reminder and is idempotent", async () => {
    await seedTenant();
    // Due in 2 days: inside the 3-day due-soon window.
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await seedInvoice(due);

    const first = await generateReminders(staff);
    expect(first.dueSoon).toBe(1);

    const items = await db().collection("smsOutbox").get();
    expect(items.size).toBe(1);
    expect(items.docs[0].data().campaignId).toBe("rent_due_reminder:inv_1:due_soon");
    expect(items.docs[0].data().body).not.toContain("{{");

    // A second run must not repeat the same notice.
    const second = await generateReminders(staff);
    expect(second.dueSoon).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("queues arrears notices on the overdue cadence", async () => {
    await seedTenant();
    // 14 days overdue = exactly two 7-day cycles.
    const due = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    await seedInvoice(due);

    const outcome = await generateReminders(staff);
    expect(outcome.overdue).toBe(1);

    const items = await db().collection("smsOutbox").get();
    expect(items.docs[0].data().templateKey).toBe("arrears_notice");
  });

  it("skips tenants without SMS consent", async () => {
    await seedTenant({ consentSms: false });
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await seedInvoice(due);

    const outcome = await generateReminders(staff);

    expect(outcome).toEqual({ dueSoon: 0, overdue: 0, skipped: 1 });
    expect(await db().collection("smsOutbox").get()).toHaveProperty("empty", true);
  });

  it("does nothing for paid-up tenants", async () => {
    await seedTenant();
    await db()
      .collection("invoices")
      .doc("inv_1")
      .set({
        tenantId: "tnt_1",
        leaseId: "lease_1",
        unitId: "unit_1",
        propertyId: "prop_1",
        periodKey: "2026-10",
        dueDate: Timestamp.fromDate(
          new Date(Date.now() + 2 * 86_400_000),
        ),
        amountDueMinor: 4_500_000,
        amountPaidMinor: 4_500_000,
        balanceMinor: 0,
        currency: "KES",
        status: "paid",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    const outcome = await generateReminders(staff);
    expect(outcome).toEqual({ dueSoon: 0, overdue: 0, skipped: 0 });
    expect(await db().collection("smsOutbox").get()).toHaveProperty("empty", true);
  });
});
