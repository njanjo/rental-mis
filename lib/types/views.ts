import type {
  Currency,
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
  notes?: string;
  activeLeaseId?: string;
  activeTenantId?: string;
  tenantName?: string;
  /** Number of leases in any state, for the detail screen. */
  leaseCount: number;
  createdAt: string;
  updatedAt: string;
}

export type UnitDetail = UnitListItem;

export interface TenantListItem {
  id: string;
  fullName: string;
  phoneE164: string;
  nationalIdLast4?: string;
  status: TenantStatus;
  consentSms: boolean;
  notes?: string;
  currentLeaseId?: string;
  currentUnitId?: string;
  currentPropertyId?: string;
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
  unitId: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  rentAmountMinor: MinorUnits;
  depositAmountMinor: MinorUnits;
  dueDay: number;
  status: LeaseStatus;
  terminatedAt?: string;
  terminationReason?: string;
  renewedFromLeaseId?: string;
  createdAt: string;
  updatedAt: string;
}

export type LeaseDetail = LeaseListItem;

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
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
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
