# Repository governance

Covers AUD-01 (CI), AUD-02 (branch protection) and AUD-03 (security scanning). The workflow and
policy files are in this repository; the remaining steps need an **organization owner** because
they change billing, plan or organization security settings.

## Current blockers (verified 2026-11-27)

| Finding | Observed state | Cause |
|---|---|---|
| AUD-01 | Every Actions run ends in `startup_failure` | Annotation: *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* |
| AUD-02 | Branch protection and rulesets API return HTTP 403 | Private repository on the GitHub Free plan: *"Upgrade to GitHub Pro or make this repository public."* |
| AUD-03 | Code scanning API returns HTTP 403 | *"Code Security must be enabled for this repository."* |

## Owner steps

1. **Restore Actions (AUD-01).** Organization Settings → Billing and plans → fix the failed payment
   or raise the Actions spending limit. Then re-run the latest `Application CI` workflow on `main`
   and confirm `verify`, `integration`, `e2e` and `dependency-audit` succeed.
2. **Enable rulesets (AUD-02).** Upgrade the organization to GitHub Team (or make the repository
   public). Then import the ruleset:
   ```bash
   gh api -X POST repos/RavDev-Technologies-LLC/RavPaper-Tutor/rulesets --input .github/rulesets/main.json
   ```
   The ruleset requires a pull request with one approval from a code owner, approval after the last
   push, resolved threads, linear history, no force-push or deletion, and the CI checks
   `verify`, `integration`, `e2e`, `dependency-audit` and `codeql (javascript-typescript)`.
   It has no bypass actors; add an emergency bypass role only with a written break-glass procedure.
3. **Code owners.** Grant `@RavDev-Technologies-LLC/review-and-approval-team` write access to this
   repository (CODEOWNERS entries are ignored for teams without access). Consider a separate
   security team for the security-sensitive paths listed in `.github/CODEOWNERS`.
4. **Security scanning (AUD-03).** Enable GitHub Code Security (Settings → Code security) for the
   repository, plus secret scanning and push protection. The `CodeQL` workflow then uploads results.
   Triage every alert as fixed, dismissed with reason, or tracked in an issue before release.
5. **Release governance.** Tag releases from `main` only after all required checks pass on the
   exact commit, and record the tag in the findings register.

Until steps 1–4 are complete, AUD-01 to AUD-03 remain **open**: the configuration exists but is not
enforced.
