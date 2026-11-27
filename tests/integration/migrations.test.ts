import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { DATABASE_URL, closePool } from "./harness.ts";

const { pool } = await import("../../server/db.ts");
const { runMigrations, migrationStatus, baselineExistingDatabase } = await import("../../server/migrations.ts");
after(closePool);

async function wipe() {
  await pool.query(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
}
async function applyBaselineSqlOnly() {
  // Simulates a database created earlier with `drizzle-kit push` (no migration history).
  const sqlText = readFileSync("migrations/0000_baseline.sql", "utf8").split("--> statement-breakpoint");
  for (const stmt of sqlText) if (stmt.trim()) await pool.query(stmt);
}
const tableExists = async (t: string) => (await pool.query(`select to_regclass($1) t`, [t])).rows[0].t !== null;

test("fresh database: all migrations apply and re-running is a no-op", async () => {
  await wipe();
  await runMigrations(pool);
  const s = await migrationStatus(pool);
  assert.equal(s.pending, 0);
  assert.equal(s.applied, s.available);
  await runMigrations(pool);
  assert.ok(await tableExists("public.analysis_jobs"));
  assert.ok(await tableExists("public.refresh_tokens"));
});

test("concurrent migrators serialize on the advisory lock", async () => {
  await wipe();
  const extra = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await Promise.all([runMigrations(pool), runMigrations(extra)]);
  } finally {
    await extra.end();
  }
  assert.equal((await migrationStatus(pool)).pending, 0);
});

test("legacy database must be baselined explicitly, then upgrades with backfill", async () => {
  await wipe();
  await applyBaselineSqlOnly();
  const [t] = (await pool.query(`insert into tenants (name, slug) values ('T', 't') returning id`)).rows;
  const [u] = (await pool.query(`insert into users (tenant_id, username, email, password, full_name) values ($1, 'u', 'u@x.com', 'x', 'U') returning id`, [t.id])).rows;
  const [d] = (await pool.query(`insert into documents (tenant_id, user_id, title, submission_type, file_name) values ($1, $2, 'D', 'dissertation', 'd.txt') returning id`, [t.id, u.id])).rows;
  await pool.query(`insert into analysis_results (tenant_id, document_id, engine_type) values (null, $1, 'formatting')`, [d.id]);

  assert.equal((await migrationStatus(pool)).baselineRequired, true);
  await assert.rejects(runMigrations(pool), /baseline/);
  await baselineExistingDatabase(pool);
  await runMigrations(pool);
  const [r] = (await pool.query(`select tenant_id from analysis_results`)).rows;
  assert.equal(r.tenant_id, t.id, "derived tenant backfilled");
  assert.equal((await migrationStatus(pool)).pending, 0);
});

test("legacy database with unrecoverable violations rolls back completely", async () => {
  await wipe();
  await applyBaselineSqlOnly();
  await pool.query(`insert into users (tenant_id, username, email, password, full_name) values (null, 'orphan', 'o@x.com', 'x', 'O')`);
  await baselineExistingDatabase(pool);
  await assert.rejects(runMigrations(pool), /users/);
  assert.equal(await tableExists("public.analysis_jobs"), false, "no partial schema");
  assert.equal((await migrationStatus(pool)).pending, 1);
  // Operator fixes the data and re-runs.
  await pool.query(`delete from users where tenant_id is null`);
  await runMigrations(pool);
  assert.equal((await migrationStatus(pool)).pending, 0);
});
