# Phase 8 — Launch readiness

Status: in progress. Security review done in code; backups & external
monitoring are one-time console actions marked below.

## 1. Security review — code audit (done 2026-11)

Audited surfaces and verdicts:

| Surface | Finding |
| --- | --- |
| `firestore.rules` | ✅ Deny-all default; every collection enumerated; all writes trusted-backend-only; finance/audit reads scoped; `users` writes denied (role provisioning only via Admin SDK). Test suite covers rules. |
| `middleware.ts` | ✅ Cookie-presence UX gate only, as documented — real verification is Admin SDK `verifySessionCookie` in `app/(dashboard)/layout.tsx` (confirmed). Also bounces `__session` requests whose `__session_fp` companion cookie is missing or stale (stolen-cookie replay guard). |
| 2FA login (`/api/auth/otp/{request,verify}`) | ✅ Password → Admin SDK-verified ID token → 6-digit OTP via Beam to the profile phone. Challenge hashed, 10-min expiry, 5 attempts, 60s request cooldown, machine fingerprint bound, phone-swap rejected, every failure audited. Only the verify route mints `__session`; the old token→cookie route was removed so the second factor cannot be bypassed. |
| M-Pesa webhooks (validation/stk/confirmation) | ✅ Secret-in-path + timing-safe comparison (`callbackSecretMatches`); non-matching → 401; unconfigured → 503. |
| Cron route (`/api/cron/{secret}`) | ✅ Same shared-secret-in-path pattern. |
| Secrets | ✅ Real secrets only via env; public identifiers whitelisted for build (netlify.toml). FIREBASE_SERVICE_ACCOUNT JSON form supported app-wide. |
| Headers | ✅ **Added this phase** — `next.config.ts headers()`: X-Frame-Options DENY, nosniff, strict referrer, Permissions-Policy lockout, HSTS (2y), CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`. Netlify serves them via the Next runtime. |

Accepted residuals (documented, revisit post-launch):

- ~~**No rate limiting** on the OTP request route~~ — closed by Phase 8's OTP
  hardening: 60s request cooldown, 5-attempt challenge cap, and audit rows for
  every failed verify. A forged sign-in must still mint a valid Firebase ID
  token — infeasible to brute force; Firebase throttles upstream.
- **Email enumeration**: the session endpoint answers "not provisioned" (403)
  for valid tokens of unknown staff accounts. Requires a valid Firebase
  credential, so exposure is bounded to other login-enabled Google accounts.
- **No full script CSP** (Next/Turbopack inline scripts). Current CSP blocks
  framing/objects; a nonce-based script CSP is a later hardening step.
- **`inPropertyScope` has an unused function warning** in rules compile
  (WL-50:14) — harmless, cleaned up opportunistically.

## 2. Backups — one-time console setup (owner action)

Production project: `rental-mis-prod` (Firestore location `europe-west1`).

1. **Point-in-time recovery (PITR)** — Firebase console → Firestore →
   *Disaster recovery* → enable. Gives rolling 7-day recovery windows.
2. **Managed daily backup** — Firebase console → Firestore → *Backups* →
   *Create schedule*: daily, retention **30 days**, include all collections
   (audit trails are append-only and must never be excluded).
   gcloud equivalent:
   ```bash
   gcloud firestore backup schedules create \
     --project=rental-mis-prod --location=europe-west1 \
     --database='(default)' --recurrence=daily --retention=30d
   ```
3. **Restore runbook** (documented, drill once before go-live):
   - PITR: `gcloud firestore databases restore --source-backup=…` into a
     NEW database, export/verify a collection, then switchover is a code
    /config change (database id lives in project settings, not code).
   - Managed backup: console → *Backups* → select → *Restore*. Restores
     into a new database id first — never in-place.
   - Netlify side: rollback = deploys list → previous publish → *Restore*.
4. **Verification cadence**: after enabling, check the first daily backup
   landed (`gcloud firestore backups list --location=europe-west1`) and add
   a monthly calendar reminder to sample-restore one collection.

## 3. Monitoring

| Layer | Mechanism | Status |
| --- | --- | --- |
| Deploy verification | `deploy.yml` smoke — healthz + post-swap settle re-probe | ✅ live |
| Pipeline quality | `ci.yml` full emulator suite on every PR/push | ✅ live |
| Uptime | `uptime.yml` — scheduled probe every 30 min, fails loudly | ✅ live |
| External alerting (email/SMS) | Free monitor (e.g. UptimeRobot) on `/api/healthz` every 5 min | ⬜ owner action, optional reinforcement |
| Cost guardrails | GCP console → Billing → budget alert (e.g. 50/90/100%) | ⬜ owner action |

## 4. Training & go-live

- Staff provisioning runbook: `README.md` → Scripts table +
  `npx tsx scripts/provision-staff.ts` (rehearsed against emulators).
- First production admin: provision, log into the live site, verify the
  dashboard and admin-only capabilities land correctly.
- Open business decisions (blockers for real go-live, not code):
  - **Late fees** — disabled by policy (Decision 13) pending finance sign-off.
  - **Bank/M-Pesa product tuning** — Phase 1 discovery sign-offs.
- Go-live sign-off checklist:
  - [ ] Production admin provisioned & login verified
  - [ ] PITR + managed backup enabled; first backup verified
  - [ ] Budget alert configured
  - [ ] External uptime monitor (optional) configured
  - [ ] Late-fee policy decision recorded in DECISIONS.md
  - [ ] Finance/manager staff provisioned for real properties
  - [ ] Deployment smoke + uptime green for 48h
