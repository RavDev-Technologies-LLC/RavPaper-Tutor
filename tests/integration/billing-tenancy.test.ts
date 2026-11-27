import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { Client, GENEROUS_LIMITS, resetDatabase, startServer, closePool, query, grantCredits, type TestServer } from "./harness.ts";

let server: TestServer;
const sessions = new Map<string, any>();
const lineItems = new Map<string, any[]>();
const realStripe = new Stripe("sk_test_integration");

before(async () => {
  await resetDatabase();
  const { setStripeClientFactory } = await import("../../server/stripeClient.ts");
  setStripeClientFactory(() => {
    const s = new Stripe("sk_test_integration") as any;
    s.accounts = { retrieve: async () => ({ id: process.env.STRIPE_ACCOUNT_ID }) };
    s.checkout = { sessions: {
      retrieve: async (id: string) => { const x = sessions.get(id); if (!x) throw new Error("No such session"); return x; },
      listLineItems: async (id: string) => ({ data: lineItems.get(id) ?? [], has_more: false }),
    } };
    return s;
  });
  server = await startServer({ authRateLimits: GENEROUS_LIMITS });
});
after(async () => { await server.close(); await closePool(); });

async function buyer(name: string) {
  const c = new Client(server.url);
  const r = await c.register(name);
  const user = r.data.user;
  await query(`update users set stripe_customer_id = $2 where id = $1`, [user.id, `cus_${name}`]);
  return { c, user };
}

function paidSession(id: string, user: any, over: Partial<any> = {}, item: Partial<any> = {}) {
  const s = { id, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", livemode: false, currency: "usd",
    amount_total: 1999, customer: user.stripeCustomerId ?? `cus_${user.username.slice(5)}`,
    metadata: { userId: user.id, tenantId: String(user.tenantId), credits: "5", productId: "prod_FIVE", priceId: "price_FIVE" }, ...over };
  sessions.set(id, s);
  lineItems.set(id, [{ quantity: 1, amount_total: 1999, price: { id: "price_FIVE", product: "prod_FIVE" }, ...item }]);
  return s;
}

async function deliver(event: object, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
  const payload = JSON.stringify(event);
  const sig = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${server.url}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body: payload });
}

const event = (id: string, session: any, over: Partial<any> = {}) => ({ id, object: "event", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session }, ...over });
const balance = async (id: string) => (await query(`select review_credits from users where id = $1`, [id]))[0].review_credits;

test("signed webhook fulfils exactly once across redeliveries and the redirect fallback", async () => {
  const { c, user } = await buyer("payer");
  const s = paidSession("cs_test_once", user);
  const ev = event("evt_once", s);
  const results = await Promise.all([deliver(ev), deliver(ev), deliver(ev)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(await balance(user.id), 5);
  // A different event for the same checkout session (async_payment_succeeded) must not double-credit.
  assert.equal((await deliver(event("evt_once_b", s, { type: "checkout.session.async_payment_succeeded" }))).status, 200);
  const v = await c.req("POST", "/api/stripe/verify-session", { json: { sessionId: "cs_test_once" } });
  assert.equal(v.status, 200);
  assert.equal(v.data.alreadyProcessed, true);
  assert.equal(await balance(user.id), 5);
  const ledger = await query(`select count(*)::int n from credit_transactions where stripe_session_id = 'cs_test_once'`);
  assert.equal(ledger[0].n, 1);
  const ev2 = await query(`select status from stripe_events where id = 'evt_once'`);
  assert.equal(ev2[0].status, "processed");
});

test("webhook rejects bad signatures and foreign mode or account", async () => {
  const { user } = await buyer("forger");
  const s = paidSession("cs_test_forged", user);
  assert.equal((await deliver(event("evt_forged", s), "whsec_wrong")).status, 400);
  assert.equal((await fetch(`${server.url}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 400);
  assert.equal((await deliver(event("evt_live", s, { livemode: true }))).status, 400);
  assert.equal((await deliver(event("evt_acct", s, { account: "acct_OTHER" }))).status, 400);
  assert.equal(await balance(user.id), 0);
});

test("fulfillment enforces allowlist, exact amount, line items and ownership", async () => {
  const { user } = await buyer("tamper");
  const { user: other } = await buyer("victim");
  const cases: [string, any, any][] = [
    ["cs_test_meta", { metadata: { userId: user.id, tenantId: String(user.tenantId), credits: "500", productId: "prod_EVIL", priceId: "price_EVIL" } }, {}],
    ["cs_test_amount", { amount_total: 1 }, {}],
    ["cs_test_items", {}, { price: { id: "price_ONE", product: "prod_ONE" } }],
    ["cs_test_qty", {}, { quantity: 3 }],
    ["cs_test_owner", { customer: "cus_victim" }, {}],
    ["cs_test_unpaid", { payment_status: "unpaid" }, {}],
    ["cs_test_eur", { currency: "eur" }, {}],
  ];
  for (const [id, over, item] of cases) {
    assert.equal((await deliver(event(`evt_${id}`, paidSession(id, user, over, item)))).status, 200, id);
  }
  assert.equal(await balance(user.id), 0);
  assert.equal(await balance(other.id), 0);
  const rejected = await query(`select count(*)::int n from stripe_events where status = 'rejected'`);
  assert.equal(rejected[0].n, 6); // unpaid is acknowledged without a rejection
});

test("verify-session cannot claim another user's checkout", async () => {
  const { user: owner } = await buyer("owner");
  const { c: thief } = await buyer("thief");
  paidSession("cs_test_steal", owner);
  assert.equal((await thief.req("POST", "/api/stripe/verify-session", { json: { sessionId: "cs_test_steal" } })).status, 403);
  assert.equal((await thief.req("POST", "/api/stripe/verify-session", { json: { sessionId: "../../etc" } })).status, 400);
});

test("checkout only accepts allow-listed prices", async () => {
  const { c } = await buyer("shopper");
  const r = await c.req("POST", "/api/stripe/checkout", { json: { priceId: "price_EVIL", productId: "prod_EVIL" } });
  assert.equal(r.status, 400);
});

test("ledger idempotency holds under concurrent addCredits for one session", async () => {
  const { user } = await buyer("racer");
  const { storage } = await import("../../server/storage.ts");
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => storage.addCredits(user.id, 5, "race", "cs_test_race")));
  assert.ok(outcomes.every((o) => o.status === "fulfilled"));
  assert.equal(await balance(user.id), 5);
  await assert.rejects(query(`insert into credit_transactions (user_id, tenant_id, type, amount, balance_after, description, stripe_session_id) values ($1, $2, 'purchase', 5, 10, 'dup', 'cs_test_race')`, [user.id, user.tenantId]), /duplicate key/);
});

test("concurrent analysis requests debit one credit and create one job", async () => {
  const { c, user } = await buyer("spender");
  await grantCredits(user.id, 3);
  const doc = await c.upload("Race", "race.txt", "This is a sufficiently long document body used to test concurrent analysis requests for the same document.");
  assert.equal(doc.status, 201);
  const rs = await Promise.all(Array.from({ length: 6 }, () => c.req("POST", `/api/analysis/run/${doc.data.id}`, { json: { engines: ["plagiarism"] } })));
  assert.equal(rs.filter((r) => r.status === 202).length, 1);
  assert.ok(rs.every((r) => r.status === 202 || r.status === 409));
  assert.equal(await balance(user.id), 2);
  const jobs = await query(`select count(*)::int n from analysis_jobs where document_id = $1`, [doc.data.id]);
  assert.equal(jobs[0].n, 1);
});

test("tenant isolation: users cannot read, analyze, delete or observe another tenant's data", async () => {
  const { c: a } = await buyer("tenant_a");
  const { c: b, user: ub } = await buyer("tenant_b");
  await grantCredits(ub.id, 1);
  const doc = await a.upload("Private", "p.md", "# Private\n\nConfidential chapter text that must never be visible across tenants or organizations.");
  const id = doc.data.id;
  for (const [m, p] of [["GET", `/api/documents/${id}`], ["GET", `/api/documents/${id}/annotations`], ["GET", `/api/analysis/results/${id}`], ["POST", `/api/analysis/run/${id}`], ["DELETE", `/api/documents/${id}`], ["POST", `/api/analysis/defense/${id}`]] as const) {
    const r = await b.req(m, p, m === "POST" ? { json: {} } : {});
    assert.ok([403, 404].includes(r.status), `${m} ${p} -> ${r.status}`);
  }
  assert.equal((await b.req("GET", "/api/documents")).data.length, 0);
  assert.equal(await balance(ub.id), 1, "no credit taken by forbidden request");
  // Database refuses cross-tenant child rows even if application checks were bypassed.
  const [tb] = await query(`select tenant_id from users where id = $1`, [ub.id]);
  await assert.rejects(query(`insert into annotations (tenant_id, document_id, original_text, severity, engine_type) values ($1, $2, 'x', 'info', 'formatting')`, [tb.tenant_id, id]), /foreign key/);
  await assert.rejects(query(`insert into documents (tenant_id, user_id, title, submission_type, file_name) values (null, $1, 't', 'dissertation', 'f')`, [ub.id]), /null value/);
});
