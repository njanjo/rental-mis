# Decisions log

Base spec: `Rental_MIS_Firebase_Developer_Documentation` v1.0.
Anything not listed here follows the spec as written.

## Confirmed

| # | Decision | Value | Notes |
| --- | --- | --- | --- |
| 1 | SMS provider | **Beam SMS** | Replaces Africa's Talking (spec §2, §8, App. B). Adapter goes in `services/sms/providers/beam.ts`; outbox schema unchanged. |
| 2 | Money unit | integer minor units (KES cents) | Spec §4 permits either; cents chosen now to avoid migration. |
| 3 | Framework | Next.js 15.5 | Spec says Next.js 15. |
| 4 | Auth method | email/password, admin-provisioned | No public registration, no tenant auth. SSO can be added later. |
| 5 | Session mechanism | httpOnly `__session` cookie, 5 days, verified with Admin SDK | Refresh check skipped against the Auth emulator. |
| 6 | Package manager | npm, lockfile committed | Spec §13. |
| 7 | Test runner | Vitest + rules-unit-testing | Runs inside `firebase emulators:exec`. |
| 8 | Admin SDK config | `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, ADC fallback | Never `NEXT_PUBLIC_*`. |

## Defaults taken (change before go-live if needed)

| # | Decision | Value | Impact if changed |
| --- | --- | --- | --- |
| 9 | Firebase region | `europe-west1` | Firestore + Functions; requires project recreation if changed later. |
| 10 | Roles | `admin`, `property_manager`, `finance`, `maintenance`, `auditor` | Must match `lib/types` and the capability matrix. |
| 11 | Allocation policy | oldest outstanding invoice first | Stored in `systemSettings/billing`; finance must sign off. |
| 12 | Overpayment | tenant credit | Alternative is review queue. |
| 13 | Late fees | disabled | No fee fields applied until finance defines rules. |
| 14 | Invoice ID | `{leaseId}_{YYYY-MM}` | Deterministic, prevents duplicate invoices on job rerun. |
| 15 | Timezone | `Africa/Nairobi` for rules, UTC storage | Fixed in `lib/format.ts` and settings. |

## Phase 3 implementation decisions

- **Server writes only.** Operations modules use server actions + Admin SDK. Firestore rules deny direct client writes to operations collections; the Admin SDK bypasses rules, so every service re-checks capability and property scope (`lib/auth/scope.ts`).
- **Property scope lives on the staff profile.** `users.propertyIds` is the source of truth (used by both the app and rules). Assigning or removing a manager on a property updates that profile in the same transaction, so access can never drift from `properties.managerIds`. Admin accounts are global and never carry property ids.
- **No hard deletes.** Properties and units are archived (`active: false` + `archivedAt` + reason); tenants become `former`; leases are `terminated`. History is preserved and every change is audited.
- **Audit in the same transaction.** `writeAuditLog` appends to `auditLogs` inside the caller's transaction, so a change can never commit without its audit entry.
- **Unique active tenant phone.** `tenantPhones/{e164}` keeps a single active tenant per number; this is the primary key for Phase 5 payment matching via the M-Pesa payer phone.
- **Lists are cursor-paginated.** Cursors are document ids (`startAfter(docSnapshot)`), so pages are stable and shareable. Text search runs in memory over a bounded 200-row page and therefore returns no next cursor.
- **Rent edits on an active lease** require a written reason, are audited, and take effect on the next generated invoice — never retroactively on issued invoices.
- **Optimistic concurrency.** Writes that may race (lease activation, payment allocation) run in transactions and re-read state before committing.
- **Money never leaves integer minor units.** Forms accept `15,000.50` and convert at the edge; no float arithmetic touches stored balances.
- **Units are leased, not toggled.** `status` cannot be set to `occupied` from the unit form; lease creation/termination owns occupancy. A unit with an open lease cannot be archived or moved out of `occupied`. Unit numbers are unique per property among active units; an archived unit's number may be reused, but that archived unit then cannot be restored until the duplicate is resolved.
- **Tenant scope is additive.** `tenants.propertyIds` lists every property a tenant is or was associated with (a lease unions the new property in), and `createdBy` lets staff see records they created. Tenant edits cannot move a property; leases do. Duplicate details are a validation problem, not a security one: admins see everything.
- **One active tenant per phone.** `tenantPhones/{e164}` is updated in the same transaction as the tenant, so payment matching always resolves to exactly one active tenant. Changing a phone deactivates the old index entry rather than deleting history.
- **Tenant status is a separate action.** `active → inactive/former` needs a reason and is blocked while `currentLeaseId` exists; the edit form cannot change status.
- **Soft delete everywhere.** Archived units keep their lease history and are restored, never recreated; former tenants stay visible to the staff who need their payment trail.

## Phase 3D — leases

- **Pending first, activation occupies.** A new lease is `pending` and never touches unit or tenant state. Activation is the only transition that marks the unit `occupied`, writes `activeLeaseId`/`activeTenantId`, and sets the tenant's `currentLeaseId`/`currentUnitId`/`currentPropertyId` — all in one transaction. Activation is refused before the start date or after the end date, and on a double activation.
- **One live tenancy per tenant and per unit.** Creation refuses a tenant with `currentLeaseId`, an occupied/archived/maintenance unit, an archived property, a non-active tenant, or any other `pending`/`active` lease on the unit. Activation re-checks both sides so a race cannot double-book.
- **Tenant scope widens at lease creation.** The lease unions its property into `tenants.propertyIds` in the creation transaction, because tenant lists and rules scope on that array.
- **Dates, tenant and unit are fixed after creation.** `updateLeaseTerms` changes only rent, deposit and due day, always with a written reason and a before/after audit. It is refused once a lease is `terminated`/`expired`; changes affect invoices generated afterwards, never issued ones.
- **Termination is the only exit.** Active termination clears the unit's occupancy fields (unit returns to `vacant`) and the tenant's current-tenancy fields. Pending leases can be cancelled without touching either record. An optional early `endDate` must stay inside the agreed term. Payment/invoice history is retained.
- **Renewals are linked drafts.** Only an active lease can be renewed. The renewal starts `pending`, copies tenant/unit/property/currency and inherits the deposit, and records `renewedFromLeaseId` plus the revenue reason. Activating the renewal expires the source lease and transfers occupancy in the same transaction; the source lease is never deleted.
- **Termination never deletes history.** A terminated lease keeps its `endDate`, `terminatedAt`, `terminationReason` and any renewal links so unit and tenant histories remain auditable.
- **Lease search is bounded.** Search matches tenant name/phone, unit number and property name over the same 200-row cap as other lists; list order is `startDate DESC`.
- **Detail reads are scoped.** `getLease`/`getOpenLeaseForUnit` enforce property scope in code (Admin SDK bypasses rules), mirroring list behaviour.

## Phase 3E — maintenance

- **One request per issue.** Requests are never deleted. `open → assigned → in_progress → resolved` (or `cancelled` from any live state) is enforced in the service using `canTransitionMaintenance`; `resolved` and `cancelled` are terminal, and skipped steps are rejected.
- **Assignment is scoped.** Only active staff with `update_maintenance` can own a request, and non-admin assignees must be assigned to the request's property. Admins are global. Creation with an assignee starts at `assigned`; setting an owner on an open request promotes it to `assigned`.
- **Only managers reassign.** `update_maintenance` lets maintenance staff change status, priority and notes, but reassigning work requires `manage_maintenance` (admin or property manager). Every change is audited with before/after status, priority and owner.
- **Resolving and cancelling need a note.** The note is stored as `resolutionNote` and in the audit reason; `resolvedAt`/`closedAt` are server timestamps. Progress notes overwrite `notes` (the audit log keeps the history).
- **Maintenance does not toggle unit state.** A request never changes `units.status`; taking a unit out of service (`maintenance`) and logging a repair are separate actions.
- **Listing.** Requests are ordered by `createdAt DESC` and scoped by the actor's properties. Property and status filter in Firestore (cursor pagination); priority, assignee and text search filter in memory over 200 rows, so those views return no next cursor. Search matches title, issue, unit number, property name and assignee.
- **Downtime reporting.** `resolvedAt`/`closedAt` are stored explicitly so turnaround reporting does not have to infer completion from audit logs.

## Still open (needed by Phase 5/6)

1. Real Firebase project ids for dev / staging / production (`.firebaserc` uses `demo-rental-mis`).
2. M-Pesa products: C2B confirmation only, or also STK Push / B2C.
3. Banks: which ones, and do they expose APIs, webhooks, or statement exports only.
4. Beam SMS: base URL, auth header, sender ID, delivery-report payload, rate limits.
5. Deposit handling and month-end close rules.
6. Kenya Data Protection Act: retention and access policy for national IDs,
   bank details and exports.
