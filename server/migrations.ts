import path from "node:path";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

// Versioned application migrations (drizzle-kit generated, reviewed SQL in ./migrations).
// Stripe's own `stripe` schema is managed separately by stripe-replit-sync.

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "migrations");
const LOCK_KEY = 727_001; // pg_advisory_lock key reserved for app migrations

export type MigrationStatus = { applied: number; available: number; pending: number; baselineRequired: boolean };

async function appliedCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`);
  if (!rows[0].t) return 0;
  const r = await pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
  return r.rows[0].n;
}

async function legacySchemaPresent(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass('public.users') AS t`);
  return !!rows[0].t;
}

export async function migrationStatus(pool: Pool): Promise<MigrationStatus> {
  const available = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length;
  const applied = await appliedCount(pool);
  const baselineRequired = applied === 0 && (await legacySchemaPresent(pool));
  return { applied, available, pending: Math.max(0, available - applied), baselineRequired };
}

/**
 * Mark 0000_baseline as applied on a database that was created with `drizzle-kit push`
 * before versioned migrations existed. Only valid when no migrations are recorded.
 */
export async function baselineExistingDatabase(pool: Pool): Promise<void> {
  const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    if (rows[0].n > 0) throw new Error("Migrations already recorded; baseline is only for un-versioned databases");
    if (!(await legacySchemaPresent(pool))) throw new Error("No existing schema found; run migrations normally instead of baselining");
    await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [baseline.hash, baseline.folderMillis]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Apply all pending migrations atomically under an advisory lock. */
export async function runMigrations(pool: Pool): Promise<void> {
  const status = await migrationStatus(pool);
  if (status.baselineRequired) {
    throw new Error("Existing un-versioned schema detected. Take a backup, then run `npm run db:migrate -- --baseline` once.");
  }
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK_KEY})`);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
    client.release();
  }
}
