// Standalone analysis worker: `npm run worker`. Run the web server with ANALYSIS_WORKER=off to use this exclusively.
import { startWorker } from "../server/jobs";
import { migrationStatus } from "../server/migrations";
import { pool } from "../server/db";

const status = await migrationStatus(pool);
if (status.pending > 0 || status.baselineRequired) {
  console.error("Database migrations pending; run `npm run db:migrate` first.");
  process.exit(1);
}
const stop = startWorker();
const shutdown = async () => { await stop(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
