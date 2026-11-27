## Summary

## Findings addressed
<!-- e.g. AUD-05; link docs/audits/FINDINGS_REGISTER.md rows -->

## Verification
- [ ] `npm run check`, `npm test`, `npm run build`
- [ ] `npm run test:integration` (PostgreSQL)
- [ ] `npm run test:e2e` if the client or auth flow changed
- [ ] New migration reviewed (preflight, rollback behaviour, backfill) if `shared/schema.ts` changed

## Risk and rollout
<!-- Data migration, configuration changes, forced re-login, payment impact -->
