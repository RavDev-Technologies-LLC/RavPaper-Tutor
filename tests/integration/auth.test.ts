import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client, GENEROUS_LIMITS, resetDatabase, startServer, closePool, query, type TestServer } from "./harness.ts";

let server: TestServer;
before(async () => { await resetDatabase(); server = await startServer({ authRateLimits: GENEROUS_LIMITS }); });
after(async () => { await server.close(); await closePool(); });

test("register validates input and issues an httpOnly refresh cookie", async () => {
  const c = new Client(server.url);
  assert.equal((await c.req("POST", "/api/auth/register", { json: { username: "ab", email: "x@y.z", password: "short", fullName: "X" } })).status, 400);
  const r = await c.register("alice");
  assert.equal(r.status, 201);
  assert.equal(r.data.refreshToken, undefined, "refresh token must not be in the body");
  assert.equal(r.data.user.password, undefined);
  assert.equal(r.data.user.email, "user.alice@example.com");
  const cookie = r.headers.getSetCookie().find((h) => h.startsWith("rp_rt="))!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/auth/);
  assert.equal((await c.req("GET", "/api/auth/me")).status, 200);
  // Duplicate email (case-insensitive)
  const dup = await new Client(server.url).req("POST", "/api/auth/register", { json: { username: "other_name", email: "USER.ALICE@example.com", password: "correct-horse-battery", fullName: "Dup" } });
  assert.equal(dup.status, 409);
});

test("login is case-insensitive on email and does not reveal account existence", async () => {
  await new Client(server.url).register("bob");
  const c = new Client(server.url);
  assert.equal((await c.login("USER.BOB@EXAMPLE.COM", "correct-horse-battery")).status, 200);
  const wrong = await new Client(server.url).login("user.bob@example.com", "wrong-password-123");
  const missing = await new Client(server.url).login("nobody@example.com", "wrong-password-123");
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.data, missing.data);
  const failed = await query(`select count(*)::int n from audit_logs where action = 'user_login_failed'`);
  assert.equal(failed[0].n, 1);
});

test("refresh rotates the token; reuse of an old token revokes the whole session", async () => {
  const c = new Client(server.url);
  await c.register("carol");
  const original = c.cookies.get("rp_rt")!;

  assert.equal((await c.req("POST", "/api/auth/refresh", { auth: false })).status, 403, "CSRF header required");

  const r1 = await c.refresh();
  assert.equal(r1.status, 200);
  const rotated = c.cookies.get("rp_rt")!;
  assert.notEqual(rotated, original);
  c.accessToken = r1.data.accessToken;

  // Attacker replays the original token after the grace window.
  await query(`update refresh_tokens set rotated_at = now() - interval '1 minute' where rotated_at is not null`);
  const attacker = new Client(server.url);
  attacker.cookies.set("rp_rt", original);
  assert.equal((await attacker.refresh()).status, 401);

  // The legitimate session is now revoked as well, including its access token.
  assert.equal((await c.refresh()).status, 401);
  assert.equal((await c.req("GET", "/api/auth/me")).status, 401);
  const audit = await query(`select count(*)::int n from audit_logs where action = 'refresh_token_reuse_detected'`);
  assert.equal(audit[0].n, 1);
});

test("simultaneous refreshes: one rotates, the other gets a retryable 409", async () => {
  const c = new Client(server.url);
  await c.register("dave");
  const token = c.cookies.get("rp_rt")!;
  const [a, b] = await Promise.all([0, 1].map(() => { const x = new Client(server.url); x.cookies.set("rp_rt", token); return x.refresh(); }));
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  // Session survives a benign race.
  const active = await query(`select count(*)::int n from auth_sessions s join users u on u.id = s.user_id where u.username = 'user_dave' and s.revoked_at is null`);
  assert.equal(active[0].n, 1);
});

test("logout revokes the refresh token and the access token server-side", async () => {
  const c = new Client(server.url);
  await c.register("erin");
  const token = c.cookies.get("rp_rt")!;
  const access = c.accessToken;
  assert.equal((await c.req("POST", "/api/auth/logout", { headers: { "x-ravpaper-client": "web" } })).status, 204);
  assert.equal(c.cookies.has("rp_rt"), false, "cookie cleared");
  const replay = new Client(server.url);
  replay.cookies.set("rp_rt", token);
  replay.accessToken = access;
  assert.equal((await replay.refresh()).status, 401);
  assert.equal((await replay.req("GET", "/api/auth/me")).status, 401);
});

test("logout-all ends every session for the user", async () => {
  const a = new Client(server.url);
  await a.register("frank");
  const b = new Client(server.url);
  await b.login("user.frank@example.com", "correct-horse-battery");
  assert.equal((await a.req("POST", "/api/auth/logout-all")).status, 204);
  assert.equal((await b.req("GET", "/api/auth/me")).status, 401);
  assert.equal((await b.refresh()).status, 401);
});

test("tokens are rejected when the account is disabled", async () => {
  const c = new Client(server.url);
  const r = await c.register("gina");
  await query(`update users set is_active = false where id = $1`, [r.data.user.id]);
  assert.equal((await c.req("GET", "/api/auth/me")).status, 401);
  assert.equal((await c.refresh()).status, 401);
});

test("rate limits: login per IP, failed logins per account, register and refresh", async () => {
  const tight = await startServer({ authRateLimits: { windowMs: 60_000, loginPerIp: 6, loginFailuresPerAccount: 3, registerPerIp: 2, refreshPerIp: 3 } });
  try {
    const c = new Client(tight.url);
    assert.equal((await c.register("rl1")).status, 201);
    assert.equal((await new Client(tight.url).register("rl2")).status, 201);
    const third = await new Client(tight.url).register("rl3");
    assert.equal(third.status, 429);
    assert.match(third.data.error, /Too many requests/);

    for (let i = 0; i < 3; i++) assert.equal((await new Client(tight.url).login("user.rl1@example.com", "bad-password-xyz")).status, 401);
    assert.equal((await new Client(tight.url).login("user.rl1@example.com", "correct-horse-battery")).status, 429, "account locked after failures");
    assert.equal((await new Client(tight.url).login("user.rl2@example.com", "correct-horse-battery")).status, 200, "other accounts unaffected");
    for (let i = 0; i < 2; i++) await new Client(tight.url).login("nobody@example.com", "x");
    assert.equal((await new Client(tight.url).login("user.rl2@example.com", "correct-horse-battery")).status, 429, "per-IP login cap");

    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await c.refresh()).status);
    assert.deepEqual(statuses.slice(0, 3).every((s) => s === 200 || s === 401), true);
    assert.equal(statuses[3], 429);
  } finally {
    await tight.close();
  }
});
