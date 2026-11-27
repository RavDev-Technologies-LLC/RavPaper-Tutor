import { serveStatic } from "./static";
import { runMigrations as runStripeMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { createApp } from "./app";
import { assertStartupConfig, isProduction } from "./config";
import { migrationStatus } from "./migrations";
import { startWorker } from "./jobs";
import { pool } from "./db";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${formattedTime} [${source}] ${message}`);
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL!;
  try {
    console.log("Initializing Stripe schema...");
    await runStripeMigrations({ databaseUrl } as any);
    const stripeSync = await getStripeSync();
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    try {
      const result = await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
      console.log(`Webhook configured: ${result?.webhook?.url || "OK"}`);
    } catch (webhookErr: any) {
      console.warn("Webhook setup skipped (may need deployment):", webhookErr.message);
    }
    stripeSync.syncBackfill().then(() => console.log("Stripe data synced")).catch((err: any) => console.error("Error syncing Stripe data:", err));
  } catch (error) {
    console.error("Failed to initialize Stripe:", error);
  }
}

(async () => {
  assertStartupConfig();

  // Production never alters schema at startup; it refuses to serve against an unmigrated database.
  const status = await migrationStatus(pool);
  if (status.pending > 0 || status.baselineRequired) {
    const msg = `Database migrations pending: ${status.baselineRequired ? "legacy schema needs `npm run db:migrate -- --baseline`" : `${status.pending} pending`}`;
    if (isProduction()) { console.error(msg); process.exit(1); }
    console.warn(`${msg}. Run \`npm run db:migrate\`.`);
  }

  if (!isProduction() && process.env.STRIPE_DEV_PROVISION === "true") await initStripe();

  const { app, httpServer } = await createApp();

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // In-process worker by default; set ANALYSIS_WORKER=off when running `npm run worker` separately.
  const stopWorker = process.env.ANALYSIS_WORKER === "off" ? null : startWorker();

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => log(`serving on port ${port}`));

  const shutdown = async () => {
    httpServer.close();
    await stopWorker?.();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
