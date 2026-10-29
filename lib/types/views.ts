import type {
  BankSyncStatus,
  Currency,
  InvoiceStatus,
  LeaseStatus,
  MaintenancePriority,
  MaintenanceStatus,
  MinorUnits,
  PaymentProvider,
  PaymentSource,
  PaymentStatus,
  ReviewStatus,
  Role,
  TenantStatus,
  UnitStatus,
} from "@/lib/types";
import type {
  BankColumnMapping,
  BankImportDateFormat,
} from "@/lib/bank-import";

/**
 * View models passed from server components to the UI.
 *
 * Firestore `Timestamp` instances cannot cross the server/client boundary, so
 * every instant is an ISO string here. Money stays in integer minor units.
 */

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PropertyListItem {
  id: string;
  name: string;
  address: string;
  county: string;
  active: boolean;
  unitCount: number;
  occupiedCount: number;
  managerIds: string[];
  managerNames: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PropertyDetail = PropertyListItem;

export interface UnitListItem {
  id: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  rentAmountMinor: MinorUnits;
  depositAmountMinor: MinorUnits;
  currency: Currency;
  status: UnitStatus;
  active: boolean;
  notes?: string;
  archiveReason?: string;
  activeLeaseId?: string;
  activeTenantId?: string;
  tenantName?: string;
  tenantPhone?: string;
  createdAt: string;
  updatedAt: string;
}

export type UnitDetail = UnitListItem;

/** One row in a unit's lease history. */
export interface UnitLeaseHistoryItem {
  id: string;
  tenantId: string;
  tenantName: string;
  startDate: string;
  endDate: string;
  rentAmountMinor: MinorUnits;
  status: LeaseStatus;
}

export interface TenantListItem {
  id: string;
  fullName: string;
  phoneE164: string;
  nationalIdLast4?: string;
  status: TenantStatus;
  consentSms: boolean;
  notes?: string;
  propertyIds: string[];
  propertyNames: string[];
  currentLeaseId?: string;
  currentUnitId?: string;
  currentPropertyId?: string;
  /** Unallocated overpayment held for future invoices, in minor units. */
  creditBalanceMinor: MinorUnits;
  unitNumber?: string;
  propertyName?: string;
  createdAt: string;
  updatedAt: string;
}

export type TenantDetail = TenantListItem;

export interface LeaseListItem {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantPhone?: string;
  unitId: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  rentAmountMinor: MinorUnits;
  depositAmountMinor: MinorUnits;
  currency: Currency;
  dueDay: number;
  status: LeaseStatus;
  terminatedAt?: string;
  terminationReason?: string;
  renewedFromLeaseId?: string;
  renewedToLeaseId?: string;
  createdAt: string;
  updatedAt: string;
}

export type LeaseDetail = LeaseListItem;

/** One payment allocation shown on an invoice. */
export interface InvoiceAllocationItem {
  id: string;
  paymentId: string;
  amountMinor: MinorUnits;
  provider: string;
  providerTransactionId: string;
  receivedAt: string;
  createdByName?: string;
  createdAt: string;
}

export interface InvoiceListItem {
  id: string;
  leaseId: string;
  tenantId: string;
  tenantName: string;
  tenantPhone?: string;
  unitId: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  periodKey: string;
  periodLabel: string;
  dueDate: string;
  amountDueMinor: MinorUnits;
  amountPaidMinor: MinorUnits;
  balanceMinor: MinorUnits;
  currency: Currency;
  /** Derived status: open/partial become overdue after the due date. */
  status: InvoiceStatus;
  storedStatus: InvoiceStatus;
  isOverdue: boolean;
  billableDays?: number;
  periodDays?: number;
  /** Part of amountPaidMinor that came from tenant credit rather than cash. */
  creditAppliedMinor: MinorUnits;
  voidReason?: string;
  voidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  allocations: InvoiceAllocationItem[];
}

export interface InvoiceGenerationResult {
  periodKey: string;
  created: number;
  skipped: number;
  total: number;
}

/** Aggregate numbers shown above the invoice list. */
export interface InvoiceSummary {
  /** Period the billed figures describe. */
  periodKey: string;
  periodLabel: string;
  /** Live invoices (open + partial) across the actor's scope. */
  outstandingMinor: MinorUnits;
  openCount: number;
  /** Live invoices whose due date has passed. */
  overdueMinor: MinorUnits;
  overdueCount: number;
  /** Non-void invoices issued for `periodKey`. */
  billedMinor: MinorUnits;
  billedCount: number;
}

/** One invoice settled (or part-settled) by a payment. */
export interface PaymentAllocationLine {
  id: string;
  invoiceId: string;
  periodKey: string;
  periodLabel: string;
  dueDate: string;
  amountMinor: MinorUnits;
  createdAt: string;
}

export interface PaymentListItem {
  id: string;
  provider: PaymentProvider;
  providerTransactionId: string;
  amountMinor: MinorUnits;
  currency: Currency;
  tenantId?: string;
  tenantName?: string;
  tenantPhone?: string;
  leaseId?: string;
  propertyId?: string;
  propertyName?: string;
  status: PaymentStatus;
  source: PaymentSource;
  bankCode?: string;
  narration?: string;
  payerName?: string;
  payerPhone?: string;
  allocatedMinor: MinorUnits;
  creditAddedMinor: MinorUnits;
  reversalOfPaymentId?: string;
  reversalReason?: string;
  receivedAt: string;
  confirmedAt?: string;
  confirmedByName?: string;
  reversedAt?: string;
  reversedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDetail extends PaymentListItem {
  allocations: PaymentAllocationLine[];
  /** Set when this payment has been reversed. */
  reversalPaymentId?: string;
}

export interface UnmatchedPaymentListItem {
  id: string;
  paymentId: string;
  amountMinor: MinorUnits;
  currency: Currency;
  provider: PaymentProvider;
  providerTransactionId: string;
  payerName?: string;
  payerPhone?: string;
  narration?: string;
  receivedAt: string;
  candidateTenantIds: string[];
  candidateTenantNames: string[];
  reason: string;
  reviewStatus: ReviewStatus;
  resolutionNote?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  createdAt: string;
}

/** How the importer will treat one statement row. */
export type BankRowMatch = "tenant" | "unmatched" | "out_of_scope" | "duplicate";

export interface BankImportPreviewRow {
  /** 1-based line in the uploaded file. */
  line: number;
  date: string;
  reference: string;
  amountMinor: MinorUnits;
  payerName?: string;
  payerPhone?: string;
  narration?: string;
  match: BankRowMatch;
  tenantId?: string;
  tenantName?: string;
  /** Why this row will be queued instead of allocated. */
  reason?: string;
}

export interface BankImportIssue {
  line: number;
  kind: "skipped" | "error";
  message: string;
}

export interface BankImportTotals {
  /** Credit rows that produced a receipt. */
  dataRows: number;
  /** Rows that will allocate straight away. */
  matched: number;
  unmatched: number;
  outOfScope: number;
  duplicates: number;
  /** Debits, totals and blank lines. */
  skipped: number;
  errors: number;
  /** Sum of importable credits, not net of debits. */
  amountMinor: MinorUnits;
}

export interface BankImportPreview {
  fileName?: string;
  bankCode: string;
  headers: string[];
  /** 1-based line of the detected header row. */
  headerLine: number;
  mapping: BankColumnMapping;
  dateFormat: BankImportDateFormat;
  /** Capped at 300 rows for display; the commit still imports every row. */
  rows: BankImportPreviewRow[];
  issues: BankImportIssue[];
  totals: BankImportTotals;
  truncated: boolean;
}

export interface BankImportResult {
  runId: string;
  imported: number;
  queued: number;
  duplicates: number;
  skipped: number;
  errors: number;
}

export interface BankImportRunItem {
  id: string;
  bankCode: string;
  fileName?: string;
  status: BankSyncStatus;
  fetched: number;
  imported: number;
  queued: number;
  duplicates: number;
  skipped: number;
  errors: number;
  startedAt: string;
  finishedAt?: string;
}

/** Client state shared by the preview and commit server actions. */
export interface BankImportFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  preview?: BankImportPreview;
  result?: BankImportResult;
}

export interface MaintenanceListItem {
  id: string;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitNumber: string;
  title: string;
  issue: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assignedTo?: string;
  assignedToName?: string;
  createdBy: string;
  createdByName?: string;
  notes?: string;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  closedAt?: string;
}

export type MaintenanceDetail = MaintenanceListItem;

/** Minimal shape for pickers and selects. */
export interface StaffOption {
  uid: string;
  fullName: string;
  role: Role;
  propertyIds: string[];
  active: boolean;
}

export interface PropertyOption {
  id: string;
  name: string;
  active: boolean;
}

export interface UnitOption {
  id: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  rentAmountMinor: MinorUnits;
  depositAmountMinor: MinorUnits;
  status: UnitStatus;
}

export interface TenantOption {
  id: string;
  fullName: string;
  phoneE164: string;
  status: TenantStatus;
}

export interface SelectOption {
  value: string;
  label: string;
}
