# Rental MIS

Property operations platform for landlords and property managers in Kenya.

Admins and staff run everything from one dashboard. **Tenants have no login and
no portal** — they receive SMS and pay by M-Pesa or bank.

> Specification: `Rental_MIS_Firebase_Developer_Documentation` (v1.0, 12 pages).
> This README tracks what is actually built, so treat it as the status source.

## Status — Phase 7 (Reporting: realtime dashboard, charts, CSV) complete

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Discovery (banks, M-Pesa products, finance policy) | open decisions |
| **2** | **Foundation: Next.js, Firebase, auth, roles, rules, CI hygiene** | **done** |
| **3** | **Operations: properties, units, tenants, leases, maintenance** | **done** |
| **4** | **Billing: invoices, allocations, credit, arrears** | **done** |
| **5A** | **Payments: manual receipts, ledger, unmatched queue, reversals** | **done** |
| **5B** | **Bank statement CSV import with phone matching** | **done** |
| **5C** | **M-Pesa Daraja: C2B paybill callbacks + STK Push (route handlers)** | **done** |
| **6** | **Automation: Beam SMS outbox, receipts, rent reminders, cron route** | **done** |
| **7** | **Reporting: realtime dashboard, charts, CSV exports** | **done** |
| 8 | Launch: security review, backups, monitoring, training | not started |

## Stack

- Next.js 15.5 (App Router, Turbopack) + TypeScript + Tailwind v4
- shadcn/ui (radix) + lucide icons
- Firebase Auth (email/password, staff only), Cloud Firestore, Admin SDK
- Session cookies (`__session`, 5 days, httpOnly) verified server-side
- Vitest + `@firebase/rules-unit-testing` against the emulator suite

Planned: Cloud Functions 2nd gen, M-Pesa Daraja, bank adapters, **Beam SMS**
(replaces Africa's Talking in the original spec), Vercel hosting.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # emulator defaults are fine
npm run emulators                  # terminal 1 — UI at http://127.0.0.1:4000
npm run seed                       # terminal 2 — demo staff + portfolio
npm run dev                        # terminal 2 — http://localhost:3000
```

Emulator projects must use a `demo-*` id (`demo-rental-mis`). The seed script
refuses to run against anything else.

### Demo accounts

All use `Password123!`.

| Email | Role | Scope |
| --- | --- | --- |
| admin@rentalmis.test | Administrator | all properties |
| manager@rentalmis.test | Property manager | Kilimani Heights |
| finance@rentalmis.test | Finance officer | Kilimani Heights |
| maintenance@rentalmis.test | Maintenance staff | Kilimani Heights |
| auditor@rentalmis.test | Read-only auditor | all properties |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Started emulators + full Vitest suite |
| `npm run test:rules` | Firestore rules tests only |
| `npm run emulators` | Firebase Emulator Suite (auth 9099, firestore 8080, UI 4000) |
| `npm run seed` | Wipe + seed emulator data |
| `npm run smoke:auth` | Verify password → ID token → session cookie (emulator) |
| `npm run smoke:web` | End-to-end HTTP checks (needs emulators + dev server) |
| `npm run deploy:rules` | Deploy rules + indexes to the active Firebase project |

## Layout

```
app/
  (dashboard)/            protected shell + one route per module
  api/auth/session/       POST mints __session, DELETE clears it
  login/                  staff sign-in (no registration)
components/
  layout/                 sidebar, topbar, user menu
  payments/               receipt, match, ignore and reversal dialogs;
                          bank statement import wizard
  providers/              auth provider (client)
  shared/                 page header, module placeholder, status badges
  ui/                     shadcn primitives
lib/
  auth/                   permissions matrix, session verification, landing
  allocation.ts           pure oldest-due-first payment planner
  bank-import.ts          CSV/statement parser, bank list, phone extraction
  billing.ts              period keys, proration, due dates, derived status
  payments.ts             reference normalisation + deterministic payment ids
  firebase/               client + admin singleton
  types/                  all 16 Firestore collections
firestore.rules           baseline rules (emulator-tested)
firestore.indexes.json    composites required by the spec
scripts/                  seed + smoke tests
tests/rules/              32 allow/deny cases
```

## Non-negotiables

1. **Money is integer minor units** (KES cents). Never floats, never `parseFloat`
   on a stored amount.
2. **Payments are append-only.** Reversals are new events with a reason.
3. **Only trusted backend code confirms payments.** A browser request is never
   proof of payment.
4. **Ambiguity goes to the unmatched queue.** Never guess a tenant from an
   amount or a name.
5. **Roles are assigned server-side.** A user must never be able to edit their
   own role (`users` writes are denied in rules).
6. **SMS never blocks money.** The outbox is written in the payment transaction;
   sending happens after commit and retries independently.
7. **No tenant authentication, ever.**

## Notes

- `middleware.ts` only checks that a cookie exists. Verification happens in the
  dashboard layout with the Admin SDK; Firestore rules are the real boundary.
- Every application write is server-only. Firestore rules deny client writes to
  all collections (including properties, units, tenants, leases and
  maintenance); reads still require an active staff profile.
- Admin SDK writes bypass rules, so every server path must validate the actor.
- Bank statement import is a CSV wizard at `/payments/import`. It matches by
  payer phone only, imports credits only, and sends anything uncertain to the
  unmatched queue. The preview writes nothing; commit re-parses the file.
- M-Pesa ingestion (Phase 5C): Daraja C2B paybill callbacks land at
  `/api/mpesa/confirmation/<MPESA_CALLBACK_SECRET>` (validation and STK Push
  result callbacks live beside it). Receipts match via the payer phone, feed
  the same allocation engine as 5A/5B, and store every raw payload in
  `providerEvents`. Staff can send STK prompts from Payments. Configure the
  Daraja env vars and register the URLs before go-live — see
  `.env.local.example` and `docs/DECISIONS.md`.
- SMS automation (Phase 6): payment receipts queue into `smsOutbox` inside the
  payment transaction; the worker sends through Beam with exponential backoff
  and dead-letters after 5 attempts. Rent reminders (due-soon + weekly arrears
  chase, `consentSms`-gated) generate idempotently via campaign ids. The
  scheduler hits `GET /api/cron/<CRON_SECRET>?job=all`; the SMS page has
  run-now buttons. Delivery is polled from Beam — no webhook exists.
- Reporting (Phase 7): the dashboard renders live KPIs (occupancy, collected
  this month, arrears, unmatched queue) from server aggregations and
  auto-refreshes every 60s; `/reports` adds a date range with income by
  month/channel/property, arrears ageing and CSV downloads from
  `GET /api/reports/csv?type=payments|arrears&from&to` (session + `export_reports`
  + audit log). "Collected" counts confirmed money net of reversal rows;
  unconfirmed M-Pesa payloads are never counted.
- `.env.local` holds emulator routing (`FIRESTORE_EMULATOR_HOST`,
  `FIREBASE_AUTH_EMULATOR_HOST`). Remove those two lines in production.
- Decisions log: [`docs/DECISIONS.md`](docs/DECISIONS.md).
