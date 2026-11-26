# RavPaper Tutor remediation evidence register

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
