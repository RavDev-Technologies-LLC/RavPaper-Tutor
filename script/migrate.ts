import { Pool } from "pg";
import { baselineExistingDatabase, migrationStatus, runMigrations } from "../server/migrations";

// Usage:
//   npm run db:migrate                 apply pending migrations
//   npm run db:migrate -- --status     show applied / pending counts
//   npm run db:migrate -- --baseline   adopt a database created by `db:push` (run once, after a backup)
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const args = new Set(process.argv.slice(2));
    if (args.has("--status")) {
      console.log(JSON.stringify(await migrationStatus(pool)));
      return;
    }
    if (args.has("--baseline")) {
      await baselineExistingDatabase(pool);
      console.log("Baseline recorded (0000_baseline marked as applied).");
    }
    await runMigrations(pool);
    console.log("Migrations up to date:", JSON.stringify(await migrationStatus(pool)));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
