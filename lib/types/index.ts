import type { Timestamp } from "firebase/firestore";

/**
 * Money is ALWAYS stored as an integer in minor units (KES cents).
 * Never use floating point for amounts. 1500000 === KES 15,000.00.
 */
export type MinorUnits = number;

export const CURRENCY = "KES" as const;
export type Currency = typeof CURRENCY;

/** Firestore Timestamp. Use serverTimestamp() on write. */
export type FirestoreTimestamp = Timestamp;

export type DateLike = FirestoreTimestamp | Date | string;

export const ROLES = [
  "admin",
  "property_manager",
  "finance",
  "maintenance",
  "auditor",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  property_manager: "Property manager",
  finance: "Finance officer",
  maintenance: "Maintenance staff",
  auditor: "Read-only auditor",
};

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  role: Role;
  /** Properties this user is scoped to. Empty for admin (sees everything). */
  propertyIds: string[];
  active: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  lastSignInAt?: FirestoreTimestamp;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export const UNIT_STATUSES = ["vacant", "occupied", "maintenance"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export interface Property {
  id: string;
  name: string;
  /** Lower-cased name for prefix search. Written by the service layer. */
  nameLower: string;
  address: string;
  county: string;
  managerIds: string[];
  active: boolean;
  notes?: string;
  archivedAt?: FirestoreTimestamp;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface Unit {
  id: string;
  propertyId: string;
  unitNumber: string;
  rentAmountMinor: MinorUnits;
  depositAmountMinor: MinorUnits;
  currency: Currency;
  status: UnitStatus;
  /** False once the unit is retired; history is preserved. */
  active: boolean;
  /** Denormalised for list performance; maintained with the lease. */
  activeLeaseId?: string;
  activeTenantId?: string;
  notes?: string;
  archivedAt?: FirestoreTimestamp;
  archiveReason?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

// ---------------------------------------------------------------------------
// Tenants and leases
// ---------------------------------------------------------------------------

export const TENANT_STATUSES = ["active", "inactive", "former"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface Tenant {
  id: string;
  fullName: string;
  /** Lower-cased full name for search. */
  fullNameLower: string;
  /** E.164, e.g. +254712345678 */
  phoneE164: string;
  /** Only the last 4 digits are stored for display. Full ID lives in a
   *  restricted, encrypted store — never in a client-readable document. */
  nationalIdLast4?: string;
  status: TenantStatus;
  /** SMS consent. A tenant can never be messaged after opting out. */
  consentSms: boolean;
  optedOutAt?: FirestoreTimestamp;
  /** Properties this tenant is or was associated with; drives list scope. */
  propertyIds: string[];
  /** Staff member who created the record. */
  createdBy: string;
  /** Denormalised current tenancy, maintained with the lease. */
  currentLeaseId?: string;
  currentUnitId?: string;
  currentPropertyId?: string;
  /** Unallocated overpayment held for future invoices, in minor units. */
  creditBalanceMinor?: MinorUnits;
  notes?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

/** Unique-active-phone index. Document id is the E.164 number. */
export interface TenantPhone {
  tenantId: string;
  active: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export const LEASE_STATUSES = [
  "pending",
  "active",
  "expired",
  "terminated",
] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export interface Lease {
  id: string;
  tenantId: string;
  unitId: string;
  propertyId: string;
  startDate: FirestoreTimestamp;
  endDate: FirestoreTimestamp;
  rentAmountMinor: MinorUnits;
  currency: Currency;
  /** Day of month rent falls due, 1-28. */
  dueDay: number;
  depositAmountMinor: MinorUnits;
  status: LeaseStatus;
  terminatedAt?: FirestoreTimestamp;
  terminationReason?: string;
  /** Set when this lease was created by renewing another one. */
  renewedFromLeaseId?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = [
  "open",
  "partial",
  "paid",
  "overdue",
  "void",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface Invoice {
  id: string;
  leaseId: string;
  tenantId: string;
  unitId: string;
  propertyId: string;
  /** YYYY-MM - combined with leaseId this is the deterministic invoice ID. */
  periodKey: string;
  dueDate: FirestoreTimestamp;
  amountDueMinor: MinorUnits;
  amountPaidMinor: MinorUnits;
  balanceMinor: MinorUnits;
  currency: Currency;
  status: InvoiceStatus;
  /** Billable days in the period; less than `periodDays` means prorated rent. */
  billableDays?: number;
  periodDays?: number;
  /** Part of amountPaidMinor that came from tenant credit, not cash. */
  creditAppliedMinor?: MinorUnits;
  voidReason?: string;
  voidedAt?: FirestoreTimestamp;
  voidedBy?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_PROVIDERS = ["mpesa", "bank", "manual"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = [
  "received",
  "confirmed",
  "allocated",
  "unmatched",
  "rejected",
  "reversed",
  /** A compensating ledger row created when another payment is reversed. */
  "reversal",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_SOURCES = [
  "callback",
  "poll",
  "statement",
  "manual",
] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export interface Payment {
  id: string;
  provider: PaymentProvider;
  /** Provider transaction reference. Unique per provider — idempotency key. */
  providerTransactionId: string;
  amountMinor: MinorUnits;
  currency: Currency;
  tenantId?: string;
  leaseId?: string;
  status: PaymentStatus;
  source: PaymentSource;
  bankCode?: string;
  narration?: string;
  payerName?: string;
  /** Normalised payer MSISDN, used by ingestion to match a tenant. */
  payerPhone?: string;
  /** Property the payment was matched to; drives list scope. */
  propertyId?: string;
  /** Cash portion applied to invoices. */
  allocatedMinor?: MinorUnits;
  /** Surplus moved to the tenant's credit balance. */
  creditAddedMinor?: MinorUnits;
  /** On a `reversal` row: the original payment being compensated. */
  reversalOfPaymentId?: string;
  confirmedAt?: FirestoreTimestamp;
  confirmedBy?: string;
  reversalReason?: string;
  reversedAt?: FirestoreTimestamp;
  reversedBy?: string;
  receivedAt: FirestoreTimestamp;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  invoiceId: string;
  amountMinor: MinorUnits;
  createdBy: string;
  createdAt: FirestoreTimestamp;
}

export const REVIEW_STATUSES = ["pending", "assigned", "resolved", "ignored"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface UnmatchedPayment {
  id: string;
  paymentId: string;
  candidateTenantIds: string[];
  reason: string;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: FirestoreTimestamp;
  /** How the payment was matched, or why it was left in the queue. */
  resolutionNote?: string;
  createdAt: FirestoreTimestamp;
}

export const EVENT_PROCESSING_STATUSES = [
  "received",
  "processed",
  "duplicate",
  "failed",
] as const;
export type EventProcessingStatus = (typeof EVENT_PROCESSING_STATUSES)[number];

export interface ProviderEvent {
  id: string;
  provider: PaymentProvider;
  eventId?: string;
  payloadHash: string;
  receivedAt: FirestoreTimestamp;
  processingStatus: EventProcessingStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Messaging (Beam SMS)
// ---------------------------------------------------------------------------

export const SMS_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "dead_letter",
] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

export type SmsTemplateKey =
  | "payment_receipt"
  | "rent_due_reminder"
  | "arrears_notice"
  | "lease_expiry"
  | "bulk_announcement";

export interface SmsOutboxItem {
  id: string;
  tenantId?: string;
  phoneE164: string;
  templateKey: SmsTemplateKey;
  variables: Record<string, string>;
  body: string;
  status: SmsStatus;
  attempts: number;
  nextAttemptAt: FirestoreTimestamp;
  campaignId?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export interface SmsLog {
  id: string;
  outboxId: string;
  provider: "beam";
  providerMessageId?: string;
  status: SmsStatus;
  sentAt?: FirestoreTimestamp;
  errorCode?: string;
  errorMessage?: string;
  createdAt: FirestoreTimestamp;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export const MAINTENANCE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "cancelled",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export interface MaintenanceRequest {
  id: string;
  propertyId: string;
  unitId: string;
  title: string;
  issue: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assignedTo?: string;
  /** Denormalised assignee name so lists do not need a join. */
  assignedToName?: string;
  createdBy: string;
  notes?: string;
  resolutionNote?: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  resolvedAt?: FirestoreTimestamp;
  closedAt?: FirestoreTimestamp;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export interface AuditLog {
  id: string;
  actorUid: string;
  actorRole?: Role;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  createdAt: FirestoreTimestamp;
}

export const BANK_SYNC_STATUSES = ["running", "succeeded", "failed"] as const;
export type BankSyncStatus = (typeof BANK_SYNC_STATUSES)[number];

export interface BankSyncRun {
  id: string;
  bankCode: string;
  startedAt: FirestoreTimestamp;
  finishedAt?: FirestoreTimestamp;
  cursor?: string;
  status: BankSyncStatus;
  /** Statement imports record the uploaded file for audit. */
  fileName?: string;
  source?: "statement" | "api";
  importedBy?: string;
  /** First row-level failure, kept for support without blocking the run. */
  errorSample?: string;
  counts: {
    fetched: number;
    imported: number;
    duplicates: number;
    errors: number;
    /** Statement rows that went to the unmatched queue instead. */
    queued?: number;
    /** Debits, totals and blank lines that were deliberately not imported. */
    skipped?: number;
  };
}

export interface BillingRules {
  /** Apply incoming funds to the oldest outstanding invoice first. */
  allocationStrategy: "oldest_first" | "newest_first" | "manual";
  overpayment: "tenant_credit" | "review";
  lateFeeEnabled: boolean;
  lateFeeMinor?: MinorUnits;
  gracePeriodDays: number;
  invoiceGenerationDay: number;
}

export interface ReminderRules {
  dueSoonDaysBefore: number;
  overdueRepeatDays: number;
  maxAttempts: number;
}

export interface SmsTemplate {
  key: SmsTemplateKey;
  body: string;
  enabled: boolean;
}

export interface SystemSettings {
  id: "billing" | "reminders" | "sms";
  timezone: string;
  currency: Currency;
  billing?: BillingRules;
  reminders?: ReminderRules;
  templates?: SmsTemplate[];
  updatedAt: FirestoreTimestamp;
  updatedBy: string;
}
