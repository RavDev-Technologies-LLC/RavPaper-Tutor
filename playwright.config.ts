import { defineConfig, devices } from "@playwright/test";

// Browser smoke test against the production build. Requires a disposable PostgreSQL
// database in E2E_DATABASE_URL (it is migrated, not wiped) and `npm run build` first.
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://rp:rp@localhost/rp_e2e";
const PORT = Number(process.env.E2E_PORT ?? 5055);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run db:migrate && node dist/index.cjs",
    url: `http://localhost:${PORT}/api/stripe/products`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      DATABASE_URL,
      SESSION_SECRET: "e2e-session-secret-0123456789abcdefghij",
      AI_INTEGRATIONS_OPENAI_API_KEY: "e2e-not-used",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:9/never",
      TRUST_PROXY: "loopback",
      ANALYSIS_POLL_MS: "250",
    },
  },
});
