# RavPaper Tutor remediation evidence register

## Audit of GitHub `main` at `5a41a007` (AUD-01 to AUD-15)

Work is on branch `remediation/auth-billing-integrity` (includes PR #3). Statuses describe this
branch only. **Newer Replit workspace changes have not been reconciled**: they were not visible
from GitHub, so no finding can be considered closed in both environments until the workspace is
compared with this branch and the same tests pass there.

Status key: **Implemented** = code and automated tests in this branch; **Configured** = files in
place but enforcement needs an owner action; **Partial** = meaningful remediation with stated gaps.

| ID | Severity | Status | Remediation in this branch | Evidence | Remaining |
|---|---|---|---|---|---|
| AUD-01 | Critical | Configured | CI split into `verify`, `integration` (PostgreSQL 16), `e2e` (Playwright) and `dependency-audit` | `.github/workflows/ci.yml` | Actions blocked by an org billing failure; owner must fix (docs/GOVERNANCE.md) and confirm green runs |
| AUD-02 | Critical | Configured | Ruleset JSON (reviews, code owners, required checks, linear history, no force-push), CODEOWNERS, PR template | `.github/rulesets/main.json` | Needs GitHub Team plan or public repo, then import; team needs repo access |
| AUD-03 | Critical | Configured | CodeQL workflow (`security-extended`, JS/TS and Actions), code-scanning rule in ruleset | `.github/workflows/codeql.yml` | Owner must enable Code Security; triage first results |
| AUD-04 | Critical | Implemented | Webhook verifies the Stripe signature itself, enforces account and mode, records each event in `stripe_events` and fulfils credits through `fulfillCheckoutSession`; sync mirror is secondary | `server/webhookHandlers.ts`, `server/fulfillment.ts`, `tests/integration/billing-tenancy.test.ts` | Stripe test-mode run against a real account |
| AUD-05 | High | Implemented | Refresh token is an opaque value in an httpOnly, SameSite=Strict cookie scoped to `/api/auth`; stored hashed; rotated on every use; reuse revokes the session; logout and logout-all revoke server-side; access token held in memory and bound to the session | `server/sessions.ts`, `server/auth-routes.ts`, `client/src/lib/auth.ts`, `tests/integration/auth.test.ts`, `e2e/smoke.spec.ts` | Users must sign in again once after deploy |
| AUD-06 | High | Implemented | `STRIPE_ACCOUNT_ID` and `STRIPE_MODE` required; key prefix must match mode; `accounts.retrieve()` must match the pinned account before any checkout, verify or webhook processing | `server/stripeClient.ts`, `server/billing-policy.ts` | Set production values; record account id in the release checklist |
| AUD-07 | High | Implemented | Fixed catalog (`shared/credit-catalog.ts`) plus `STRIPE_CREDIT_PRICES` allowlist; price, product, amount, currency, mode and line items must all match exactly; metadata alone is never trusted | `tests/billing-policy.test.ts`, billing integration tests | Run `server/seedProducts.ts` in each Stripe mode and configure the printed allowlist |
| AUD-08 | High | Implemented | Multipart upload; server extracts text from PDF (pdf-parse), DOCX (mammoth), TXT and Markdown; signature checks; 20 MB limit; rejects scanned PDFs, encrypted PDFs, legacy .doc and binary files | `server/extraction.ts`, `tests/extraction.test.ts` | OCR for scanned PDFs is out of scope |
| AUD-09 | High | Implemented | Ownership columns non-null; composite tenant foreign keys on all document children and document owners; case-insensitive unique email | `migrations/0001_*.sql`, isolation integration test | Reconcile workspace data before migrating production |
| AUD-10 | High | Implemented | Versioned migrations with baseline for existing databases, preflight backfill, violation report, atomic rollback, advisory lock; production refuses to start with pending migrations | `server/migrations.ts`, `script/migrate.ts`, `tests/integration/migrations.test.ts` | Restore drill on the managed database |
| AUD-11 | High | Implemented | Unique index on `credit_transactions.stripe_session_id`, partial unique index on refunds, advisory lock in `addCredits` | Concurrency integration test | None known |
| AUD-12 | High | Implemented | AI "plagiarism" prompt replaced by deterministic word-shingle comparison against documents in the same organization; findings quote the matching passage and source; every result states it does not check the web or published sources; relabelled "Source Similarity" | `server/similarity.ts`, `tests/similarity.test.ts` | External corpus comparison would need a licensed provider |
| AUD-13 | High | Implemented | `analysis_jobs` queue: request debits and enqueues atomically (202); worker uses `FOR UPDATE SKIP LOCKED` with lease and heartbeat, per-engine checkpoints, three attempts with backoff, expired-lease recovery, cooperative cancellation; credit refunded on final failure or cancel | `server/jobs.ts`, `tests/integration/documents-jobs.test.ts` | Run `npm run worker` as a separate process if scaling out |
| AUD-14 | High | Partial | 17 unit, 27 integration (real PostgreSQL) and 1 browser test covering auth, rate limits, billing, idempotency, tenancy, concurrency, uploads, jobs, crash recovery, deletion and migrations | `tests/`, `e2e/` | AI-provider contract tests, accessibility and load tests |
| AUD-15 | High | Implemented | Transactional deletion with row lock, active-job refusal, cascaded derived data, retained ledger and same-transaction audit entry | `docs/DATA_LIFECYCLE.md`, deletion integration test | Retention periods and account erasure need a policy decision |

### Also addressed (authentication review)

Rate limiting on login (per IP and per account failures), register and refresh; constant-time login
for unknown accounts; zod validation (password at least 12 characters); case-insensitive email;
failed-login audit; `SESSION_SECRET` at least 32 characters; JWT issuer, audience and algorithm
pinned; 16 KB body limit on auth routes; CSRF header on cookie-authenticated endpoints; atomic
tenant and user creation on registration; explicit `trust proxy` setting.

### New configuration

`STRIPE_ACCOUNT_ID`, `STRIPE_MODE`, `STRIPE_CREDIT_PRICES`, `STRIPE_WEBHOOK_SECRET` (optional on
Replit), `TRUST_PROXY`, `COOKIE_SECURE`, `ANALYSIS_WORKER`, `ANALYSIS_CONCURRENCY`. Run
`npm run db:migrate` (with `-- --baseline` once on databases created by `db:push`).

## Earlier register (baseline `db366c88`)

Baseline: `db366c88d8e1a889095a9133d1ae8b1412e7aeed`. Work is isolated on `remediation/rpt-security-foundation-20261126`. This is not a release authorization.

| Finding | Current implementation disposition | Required verification / remaining work |
|---|---|---|
| RPT-001, 002 | Owner-scoped document, analysis, annotation and defense route checks | Real API tests against two tenants; validate historic data consistency |
| RPT-003 | API response logging replaced by request ID and status metadata; generic internal errors | Check captured runtime logs and historical exposure |
| RPT-004 | Access/refresh purpose check and restricted signature algorithms | Complete revocation, rotation, issuer/audience and session design |
| RPT-005 | Public first-user administrator grant removed | Implement and test authorized operator bootstrap |
| RPT-006, 007 | Checkout catalog association and session user/customer/tenant binding | Stripe test-mode workflow, webhook fulfillment and reconciliation |
| RPT-008 | Transactional credit balance and ledger updates, conditional debit, session advisory lock | PostgreSQL concurrency integration tests, unique constraints and financial reconciliation |
| RPT-009 | Open | Restore and verify CodeQL issue #1; entitlement and historical logs need verification |
| RPT-010, 012 | Restrict role changes, owner scope and rubric publication/access | API authorization tests and complete institutional relationship model |
| RPT-011, 013 | Strict model response contracts, bounded engine selection, failure status and compensating credit transaction | Provider contract tests; durable worker, crash recovery and adversarial evaluations |
| RPT-014 | Tracked cache and operational state removed; ignore rules and hygiene check added | Historical secret scan, authorized rotation if exposure confirmed |
| RPT-015 | Open | Repository administrator must establish branch governance |
| RPT-016 | Open | Format-specific parsing and safe upload pipeline |
| RPT-017, 018 | Open | Retention decisions, versioned migrations, tenant constraints and database recovery |
| RPT-019 | Initial first-party policy tests and CI defined | Full API, database, browser, provider, accessibility and deployment suites |
| RPT-020 | Stripe provisioning removed from ordinary production startup; explicit development opt-in | Separate operator provisioning and migrations, production readiness checks |

## Configuration behavior changes

Checkout requires `APP_BASE_URL` (trusted HTTPS origin, or localhost HTTP in development). Live checkout remains disabled unless `STRIPE_LIVE_CHARGING_ENABLED=true` is deliberately set after approval. Production runtime must not provision Stripe schema, webhooks or backfills on startup. Development-only provisioning requires `STRIPE_DEV_PROVISION=true`. Previously issued access tokens without explicit purpose must be refreshed or replaced by login. Previously created checkout sessions without tenant and price metadata require operator reconciliation rather than automatic credit grants.

## Local evidence

Eight focused policy test cases passed on Node 22.16.0 using the repository-identical policy and test blobs. This does not establish end-to-end API, database, payment, or production readiness. No live payment or production database write was performed. No findings are certified closed solely by source edits.

## Release status

NO-GO. Exact-SHA CI, independent review, workspace reconciliation, remaining feature work, database verification, security scanning, operational evidence, and release authorization are mandatory before production.
