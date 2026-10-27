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

## Still open (needed by Phase 5/6)

1. Real Firebase project ids for dev / staging / production (`.firebaserc` uses `demo-rental-mis`).
2. M-Pesa products: C2B confirmation only, or also STK Push / B2C.
3. Banks: which ones, and do they expose APIs, webhooks, or statement exports only.
4. Beam SMS: base URL, auth header, sender ID, delivery-report payload, rate limits.
5. Deposit handling and month-end close rules.
6. Kenya Data Protection Act: retention and access policy for national IDs,
   bank details and exports.
