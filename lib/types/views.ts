import type {
  Currency,
  InvoiceStatus,
  LeaseStatus,
  MaintenancePriority,
  MaintenanceStatus,
  MinorUnits,
  Role,
  TenantStatus,
  UnitStatus,
} from "@/lib/types";

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
