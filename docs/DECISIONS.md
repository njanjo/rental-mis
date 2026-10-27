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

## Still open (needed by Phase 5/6)

1. Real Firebase project ids for dev / staging / production (`.firebaserc` uses `demo-rental-mis`).
2. M-Pesa products: C2B confirmation only, or also STK Push / B2C.
3. Banks: which ones, and do they expose APIs, webhooks, or statement exports only.
4. Beam SMS: base URL, auth header, sender ID, delivery-report payload, rate limits.
5. Deposit handling and month-end close rules.
6. Kenya Data Protection Act: retention and access policy for national IDs,
   bank details and exports.
