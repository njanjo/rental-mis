/**
 * Beam SMS formatting: templates, request payloads and response parsing.
 *
 * Pure functions only — no Firestore, no fetch. The provider contract comes
 * from `BEAMNETWORKSBULKSMSAPI.pdf`: `POST {base}/api/v3/sms/send` with
 * `Authorization: Bearer {token}`, and per-message reports at
 * `GET {base}/api/v3/sms/{uid}`. There is no delivery webhook.
 */

import type { SmsStatus, SmsTemplateKey } from "@/lib/types";
import { formatMoney } from "@/lib/format";

/** Beam recipients are bare numbers with country code, e.g. 254712345678. */
export function beamRecipient(phoneE164: string): string {
  return phoneE164.replace(/[^\d]/g, "");
}

export const DEFAULT_SMS_TEMPLATES: Record<
  Exclude<SmsTemplateKey, "lease_expiry" | "bulk_announcement">,
  string
> = {
  payment_receipt:
    "Receipt {{reference}}: {{amount}} received on {{date}}. Rent reconciled. {{balanceNote}}Thank you.",
  rent_due_reminder:
    "Hello {{name}}, rent of {{amount}} is due on {{dueDate}}. Pay via M-Pesa or bank. {{balanceNote}}",
  arrears_notice:
    "Hello {{name}}, your rent balance of {{amount}} is overdue. Kindly pay to avoid notices. Existing arrangements unaffected.",
};

/**
 * Render a template by replacing `{{key}}` slots. Unknown slots are removed
 * rather than left in the message — a half-filled SMS reads like a bug report.
 */
export function renderSmsBody(
  template: string,
  variables: Record<string, string>,
): string {
  const rendered = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key]?.trim();
    return value && value.length > 0 ? value : "";
  });
  // Collapse the whitespace left behind by dropped optional slots.
  return rendered
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

export function receiptBalanceNote(balanceMinor: number): string {
  if (balanceMinor <= 0) return "Balance: none.";
  return `Balance: ${formatMoney(balanceMinor)}.`;
}

export interface SmsInstrumentation {
  moneyMinor?: number;
  dueDate?: string;
  balanceMinor?: number;
}

/**
 * Default variable values for the templates this slice supports. Names are the
 * same keys the settings-clean templates may override.
 */
export function defaultSmsVariables(
  templateKey: SmsTemplateKey,
  facts: {
    tenantName?: string;
    reference: string;
    dateInput: string;
  } & SmsInstrumentation,
): Record<string, string> {
  const amount =
    facts.moneyMinor !== undefined ? formatMoney(facts.moneyMinor) : "";
  const balanceNote =
    facts.balanceMinor !== undefined ? receiptBalanceNote(facts.balanceMinor) : "";

  switch (templateKey) {
    case "payment_receipt":
      return {
        reference: facts.reference,
        amount,
        date: facts.dateInput,
        balanceNote,
      };
    case "rent_due_reminder":
      return {
        name: facts.tenantName ?? "",
        amount,
        dueDate: facts.dueDate ?? "",
        balanceNote,
      };
    case "arrears_notice":
      return { name: facts.tenantName ?? "", amount };
    default:
      return {};
  }
}

export interface BeamSendPayload {
  recipient: string;
  sender_id: string;
  type: "plain";
  message: string;
}

/** Build the Beam `POST /sms/send` body for one outbox item. */
export function beamSendPayload(
  phoneE164: string,
  body: string,
  senderId: string,
): BeamSendPayload {
  return {
    recipient: beamRecipient(phoneE164),
    sender_id: senderId,
    type: "plain",
    message: body,
  };
}

/**
 * Beam's documented success response is `{"status":"success","data":"..."}`,
 * and the per-message uid lives in `data` as either a string or an object
 * (`{uid}` / `{id}`). Tolerant extraction: keep it optional because the
 * platform can reply with prose instead of an id.
 */
export function beamMessageIdFromSend(
  payload: unknown,
): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as { status?: unknown; data?: unknown };

  if (record.status !== undefined && record.status !== "success") {
    return undefined;
  }

  const data = record.data;
  if (typeof data === "string" && data.trim()) {
    // A bare uid string is the happy path; prose like "sms reports with all
    // details" is a string of words — treat only uid-shaped strings as ids.
    return /^[a-z0-9]{10,}$/i.test(data.trim()) ? data.trim() : undefined;
  }
  if (data && typeof data === "object") {
    const nested = data as { uid?: unknown; id?: unknown };
    const uid = nested.uid ?? nested.id;
    if (typeof uid === "string" && uid.trim()) return uid.trim();
  }
  return undefined;
}

export interface BeamMessageReport {
  uid: string;
  /** Delivery state as Beam words, mapped onto our stored statuses. */
  status?: SmsStatus;
  rawStatus?: string;
}

/**
 * Map Beam's delivery words onto `SmsStatus`. Beam reports use variants of
 * delivered, failed, sent, scheduled or pending — everything unreadable maps
 * to `undefined` so the poll keeps the existing status.
 */
export function beamStatusForReport(raw: string): SmsStatus | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (value.includes("deliver")) return "delivered";
  if (value.includes("fail") || value.includes("reject")) return "failed";
  if (value.includes("sent") || value.includes("accept")) return "sent";
  if (value.includes("queue") || value.includes("schedul") || value.includes("pend")) {
    return "sent";
  }
  return undefined;
}

/** Extract per-message reports from a `GET /sms` list response. */
export function reportsFromBeamList(payload: unknown): BeamMessageReport[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { data?: unknown };
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray((record.data as { data?: unknown })?.data)
      ? (record.data as { data: unknown[] }).data
      : [];

  const reports: BeamMessageReport[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const uid =
      typeof item.uid === "string"
        ? item.uid
        : typeof item.id === "string"
          ? item.id
          : typeof (item as { message?: { uid?: unknown } }).message?.uid === "string"
            ? ((item as { message: { uid: string } }).message.uid)
            : undefined;
    if (!uid) continue;

    const rawStatus =
      typeof item.status === "string"
        ? item.status
        : typeof (item as { status?: { name?: unknown } }).status?.name === "string"
          ? (item as { status: { name: string } }).status.name
          : undefined;

    reports.push({
      uid,
      rawStatus,
      status: rawStatus ? beamStatusForReport(rawStatus) : undefined,
    });
  }
  return reports;
}

/** Retry backoff for a failed send attempt: 5m, 20m, 80m, capped at 6h. */
export function smsBackoffMinutes(attempt: number): number {
  return Math.min(5 * 4 ** Math.max(0, attempt - 1), 360);
}
