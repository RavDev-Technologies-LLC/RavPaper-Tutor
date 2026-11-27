// Integration test harness: real PostgreSQL, real migrations, real HTTP.
// Requires TEST_DATABASE_URL (default postgres://rp:rp@localhost/rp_test). The database is wiped.
import type { AddressInfo } from "node:net";
import pg from "pg";

export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://rp:rp@localhost/rp_test";
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL,
  SESSION_SECRET: "integration-test-secret-0123456789abcdef",
  AI_INTEGRATIONS_OPENAI_API_KEY: "test-not-used",
  AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:9/never",
  STRIPE_SECRET_KEY: "sk_test_integration",
  STRIPE_PUBLISHABLE_KEY: "pk_test_integration",
  STRIPE_ACCOUNT_ID: "acct_TEST123",
  STRIPE_MODE: "test",
  STRIPE_CREDIT_PRICES: "price_FIVE:prod_FIVE:5,price_ONE:prod_ONE:1",
  STRIPE_WEBHOOK_SECRET: "whsec_integration_secret",
  STRIPE_SYNC_MIRROR: "off",
  ANALYSIS_LEASE_MS: "4000",
  ANALYSIS_BACKOFF_MS: "1",
});

export async function resetDatabase() {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await admin.end();
  const { runMigrations } = await import("../../server/migrations.ts");
  const { pool } = await import("../../server/db.ts");
  await runMigrations(pool);
}

export type TestServer = { url: string; close: () => Promise<void> };

export async function startServer(options: Parameters<typeof import("../../server/app.ts").createApp>[0] = {}): Promise<TestServer> {
  const { createApp } = await import("../../server/app.ts");
  const { httpServer } = await createApp(options);
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const { port } = httpServer.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => { httpServer.closeAllConnections(); httpServer.close(() => r()); }) };
}

export const GENEROUS_LIMITS = { windowMs: 60_000, loginPerIp: 1000, loginFailuresPerAccount: 1000, registerPerIp: 1000, refreshPerIp: 1000 };

/** Minimal cookie-aware client for one browser profile. */
export class Client {
  cookies = new Map<string, string>();
  accessToken: string | null = null;
  constructor(public base: string) {}

  async req(method: string, path: string, opts: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; auth?: boolean } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.json !== undefined) headers["content-type"] = "application/json";
    if (opts.auth !== false && this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + path, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, v] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim())) || attrs.some((a) => /^max-age=0$/i.test(a.trim()));
      if (!v || expired) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  async register(suffix: string, password = "correct-horse-battery") {
    const r = await this.req("POST", "/api/auth/register", { json: { username: `user_${suffix}`, email: `User.${suffix}@Example.com`, password, fullName: `User ${suffix}` } });
    if (r.status === 201) this.accessToken = r.data.accessToken;
    return r;
  }

  async login(email: string, password: string) {
    const r = await this.req("POST", "/api/auth/login", { json: { email, password } });
    if (r.status === 200) this.accessToken = r.data.accessToken;
    return r;
  }

  refresh() {
    return this.req("POST", "/api/auth/refresh", { headers: { "x-ravpaper-client": "web" }, auth: false });
  }

  upload(title: string, fileName: string, content: Buffer | string, submissionType = "dissertation") {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("submissionType", submissionType);
    fd.append("file", new Blob([typeof content === "string" ? Buffer.from(content) : content]), fileName);
    return this.req("POST", "/api/documents/upload", { body: fd });
  }
}

export async function query(sqlText: string, params: unknown[] = []) {
  const { pool } = await import("../../server/db.ts");
  return (await pool.query(sqlText, params)).rows;
}

export async function grantCredits(userId: string, n: number) {
  await query(`update users set review_credits = review_credits + $2 where id = $1`, [userId, n]);
}

export async function closePool() {
  const { pool } = await import("../../server/db.ts");
  await pool.end();
}
