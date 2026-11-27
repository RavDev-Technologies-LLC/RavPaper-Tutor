# Data lifecycle

Covers AUD-09 (tenant integrity) and AUD-15 (deletion and dependent records).

## Ownership and isolation

Every user, document, analysis result, annotation, defense session, analysis job and credit
transaction carries a non-null `tenant_id`. Child records reference their document through a
composite foreign key `(document_id, tenant_id) → documents(id, tenant_id)`, and documents reference
their owner through `(user_id, tenant_id) → users(id, tenant_id)`. The database therefore rejects a
row whose tenant differs from its parent's, even if an application check were bypassed.

## Deleting a document

`DELETE /api/documents/:id` runs one transaction:

1. Lock the document row (`SELECT … FOR UPDATE`) within the caller's tenant.
2. Refuse with **409** if an analysis job is queued or running; the user cancels it first
   (`POST /api/analysis/jobs/:id/cancel`), which refunds the credit.
3. Delete the document. `ON DELETE CASCADE` removes analysis results, annotations, defense
   sessions and finished analysis jobs.
4. Keep the credit ledger. `credit_transactions.document_id` is set to `NULL`; amounts, balances,
   Stripe session ids and descriptions are retained for financial reconciliation.
5. Write a `document_deleted` audit entry with the counts of removed and retained records.

Either everything happens or nothing does.

| Record | On document deletion |
|---|---|
| Document text and metadata | Deleted |
| Analysis results, annotations | Deleted (cascade) |
| Defense sessions | Deleted (cascade) |
| Analysis jobs | Deleted (cascade); active jobs block deletion |
| Credit transactions | Retained, `document_id` nulled |
| Audit logs | Retained (they reference ids as text, not foreign keys) |
| Stripe event log (`stripe_events`) | Retained |

## Not yet decided

- **Retention periods** for audit logs, ledger and Stripe events (legal/finance decision).
- **Account deletion**: users and tenants are not deletable through the API. A future account-erasure
  flow must decide whether ledger rows are anonymised or retained under a legal basis.
- **Backups**: deleted documents remain in database backups until those expire. Document this in
  the privacy notice and set backup retention accordingly.

## Recovery testing

`tests/integration/migrations.test.ts` verifies that a failing migration rolls back completely and
can be re-run after the data is fixed. Production restore drills (point-in-time recovery of the
managed database) must be performed and recorded by operations before release.
