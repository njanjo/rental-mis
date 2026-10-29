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

## Phase 3F — server-only writes

- **Clients never write.** Every Firestore collection that holds application data (`properties`, `units`, `tenants`, `tenantPhones`, `leases`, `maintenanceRequests`, invoices, payments, allocations, unmatched payments, SMS, audit logs, settings) denies client writes in the rules. All mutations go through server actions using the Admin SDK, which enforce capabilities, property scope, validation and the audit trail in one transaction.
- **Reads stay authenticated.** Reads require an active `users` profile. Admin SDK reads bypass rules, so services still enforce property scope in code; rules are defence in depth, not the authorisation model.
- **Phone index is opaque.** `tenantPhones` is readable and writable only by trusted backend code; browsers can never enumerate tenants by phone number.
- **Rules are tested.** `npm run test:rules` covers allow/deny for auth gating, role visibility, write denial on every operations and finance collection, and the catch-all.

## Phase 4A — invoices

- **Money stays in integer minor units.** Every amount on an invoice (`amountDueMinor`, `amountPaidMinor`, `balanceMinor`) is KES cents; the UI formats with `Intl.NumberFormat` and never parses a stored amount as a float.
- **One invoice per lease and period.** The id is deterministic: `{leaseId}_{YYYY-MM}`. Generation reads the document in a transaction and skips it when it exists, so rerunning a month (or a retried job) can never double-bill.
- **Calendar-day proration.** The first and last months of a lease are billed for the days the lease overlaps the period, inclusive. `Math.round(rent × billableDays ÷ daysInMonth)` gives the nearest cent, and `billableDays`/`periodDays` are stored so the UI can explain the amount.
- **Due date inside the period.** The invoice is due on the lease `dueDay` in the billing month, clamped to that month's last day (e.g. day 31 in February). Nairobi midnight is the business date.
- **Stored vs derived status.** Firestore stores `open`, `partial`, `paid` or `void`. `overdue` is derived from the due date at read time, so it can never go stale and no nightly job is required. A paid or void invoice never becomes overdue.
- **Voiding is narrow.** `void` needs a written reason, is audited, zeroes the balance and is refused once any payment is allocated. A voided period is never regenerated; allocate/reverse the payment first, then raise a replacement invoice deliberately.
- **Generation is capability-gated and scoped.** `manage_invoices` belongs to admin and finance. Generation scans active leases with the Admin SDK, filters to the actor's properties in code, and skips leases with no overlap in the period (start after month end, end before month start).
- **Listing.** Invoices are ordered by `dueDate DESC`. Property, stored status and period filter in Firestore (cursor pagination); `overdue` and text search resolve in memory over 200 rows, so those views return no next cursor. Search matches tenant, phone digits, unit, property and period.
- **No late fees yet.** Arrears are visible through balances and the derived overdue state; fees and penalties stay out until the finance policy is agreed.

## Phase 4B — allocations, credit and arrears

- **Oldest due first, never guessed.** `lib/allocation.ts` is a pure planner: it sorts live invoices by due date (ties on id) and fills them in order. It knows nothing about Firestore, so the ordering rules are unit-tested directly. `services/allocations.ts` executes the plan in a transaction and only ever queries `open`/`partial` invoices for that tenant.
- **Overpayment becomes credit.** Any remainder after the last invoice is added to `tenants.creditBalanceMinor` and audited as `tenant.credit_added`. It is never silently dropped, and it is never allocated to an invoice outside the caller's property scope.
- **Credit auto-applies at issue.** When a new invoice is generated, the tenant document is read in the same transaction and `min(creditBalanceMinor, amountDueMinor)` settles it immediately. The memo portion is stored as `creditAppliedMinor`; `amountPaidMinor` therefore means "settled in total" (cash plus credit) and `balanceMinor` stays the single source of truth for arrears.
- **Allocation happens once per payment.** Allocation documents use the deterministic id `{paymentId}_{invoiceId}` and a second attempt for the same `paymentId` is rejected. Callers allocate exactly once per confirmed payment (Phase 5 owns event idempotency and reversal); allocation and payment can live in one transaction because `allocateWithinTransaction` performs all of its reads before writing.
- **Credit-only invoices cannot be voided.** Voiding is refused when `amountPaidMinor > 0`, which includes invoices settled purely from credit. Reversing credit is an explicit finance action in Phase 5, not a side effect of voiding.
- **Arrears summary uses aggregations.** `getInvoiceSummary` sums and counts server-side with `sum()`/`count()` over the actor's property scope (chunked at 30 properties). It reports outstanding balance, overdue balance and count, and the amount billed in the selected period, excluding `void`. Figures follow the property filter on the list page.
- **Deferred to Phase 5.** The payment record itself, the M-Pesa/bank ingestion, the unmatched queue, reversals, and marking a payment `allocated`. The allocation engine deliberately takes `{ paymentId, tenantId, amountMinor }` so the payment layer can pass its own committed values.

## Phase 5A - payment core, unmatched queue and reversals

- **References are the idempotency key.** A payment id is `pay_<sha256(provider:normalisedReference)[0..24]>`. References are trimmed, whitespace-stripped and upper-cased before hashing, so a retried callback, a double form submit and a case-variant manual entry all resolve to the same document. The transaction checks that document and refuses a duplicate instead of merging two receipts.
- **Only reconcilers touch money.** `reconcile_payments` gates unmatched matching/ignoring and allocation; `enter_manual_receipts` plus `reconcile_payments` are both required to record a manual receipt; `approve_reversals` (admin only) gates reversal. Property scope is still enforced against the chosen tenant's properties even though the unmatched queue itself is shared.
- **Provider money needs a reference.** M-Pesa and bank receipts require `providerTransactionId`; cash (`manual`) generates `MAN-YYYYMMDD-XXXXXXXX` so every payment still has a stable identity and audit trail.
- **Recording and allocating are one transaction.** `recordManualReceipt` writes the payment, allocates oldest-due-first through `allocateWithinTransaction`, and writes the audit entries together. Either the money and its ledger both exist or neither does. Any remainder becomes tenant credit through the same path used by Phase 4B.
- **Reversal is append-only.** The original payment becomes `reversed` (never edited for money) and a new payment row `rev_<paymentId>` carries the negative amount. Negative allocation rows `{reversalId}_{invoiceId}` restore each invoice, untouched credit is removed from the tenant, and the reason lands in the audit log. The original allocations remain immutable.
- **Spent credit blocks reversal.** If the overpayment was already consumed by a later invoice, the tenant's remaining credit is smaller than what this payment added. Reversal is refused with an explanation rather than driving the balance negative; finance must unwind the later invoice first.
- **Unmatched queue is never guessed.** An unknown payer can have no `propertyId`, so the queue is intentionally shared across properties and visible only to `reconcile_payments` holders. Matching still checks the chosen tenant's property scope. Ignoring keeps the payment and its row for audit; it does not delete money.
- **Payment listing follows the list conventions.** Property scope, `receivedAt DESC` and cursor pagination run in Firestore. Status, provider and free text filter in memory over 200 recent rows and therefore return no next cursor. An unmatched payment is hidden from property-scoped detail URLs (`forbidden`) and must be handled through the queue, where the reconciler can see it.
- **Ledger order is deterministic.** All allocations of one payment share the transaction timestamp, so the detail view orders them by invoice due date (ties by invoice id), matching the oldest-first plan.
- **Beam SMS stays post-commit.** Phase 5A does not send messages; the payment transaction owns money, and the SMS outbox (Phase 6) must never block or duplicate a receipt.

## Phase 5B - bank statement CSV import

- **Three steps, one source of truth.** Upload, preview and commit are separate server actions. The preview is advisory and writes nothing; the commit re-parses the same CSV and re-runs the matching, so a stale preview can never move money by itself.
- **Phone-only matching.** The importer resolves a payer phone through `tenantPhones/{e164}` (the unique-active-phone index), then re-reads the tenant and requires `status === "active"` and a property. Names, references and narrations are never used to guess an owner. Unknown, inactive or unlinked tenants go to the unmatched queue with the reason recorded.
- **Only credits are imported.** Debits, zero amounts, totals rows, repeated headers and blank lines are counted as skipped, separately from parse errors. A row that cannot be read is an error, not a zero-value receipt.
- **Parsing is defensive but not clever.** The reader handles a UTF-8 BOM, CRLF, quoted fields spanning lines, preamble banners and page-repeated headers, and detects the header row within the first 25 rows. Manual column mapping and date formats (`auto|dmy|mdy|iso`) exist because Kenyan exports are inconsistent; `auto` is always day-first and never silently US month-first. Malformed money such as `1,2,3` is rejected rather than read as `123`.
- **Idempotency comes from the payment id.** Statement rows use provider `bank` and the same deterministic `pay_<sha256(bank:reference)>` id as manual entry. Re-importing a file, or importing a reference finance already recorded, counts the row as a duplicate and writes nothing.
- **Per-row transactions, not one file transaction.** Each receipt commits its own payment + allocation + audit transaction, so one bad row does not roll back the other 1,999. The run document starts as `running`, ends `succeeded` (or `failed`) with counts, and the final update plus `bank_import.committed` audit entry commit together.
- **Scope is checked at match time.** A tenant outside the actor's properties is queued as `out_of_scope` rather than imported; unmatched receipts have no `propertyId`, consistent with the shared queue. Importing requires both `enter_manual_receipts` and `reconcile_payments`.
- **Bounded work.** A file may be 2 MB and 2,000 credit rows; the preview renders at most 300 rows. Larger statements must be split by month. Server actions raise the body limit to 4 MB to fit the CSV plus mapping fields.
- **The run is the audit trail.** `bankSyncRuns` stores the bank code, file name, importer, counts (fetched, imported, queued, duplicates, skipped, errors) and the first row failure, so support can explain an import without re-reading the original file.

## Still open (needed by Phase 5/6)

1. Real Firebase project ids for dev / staging / production (`.firebaserc` uses `demo-rental-mis`).
2. M-Pesa products: C2B confirmation only, or also STK Push / B2C.
3. Banks: which ones, and do they expose APIs, webhooks, or statement exports only. (Phase 5B covers statement CSV exports; a live bank API is still open.)
4. Beam SMS: base URL, auth header, sender ID, delivery-report payload, rate limits.
5. Deposit handling and month-end close rules.
6. Kenya Data Protection Act: retention and access policy for national IDs,
   bank details and exports.
