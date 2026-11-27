import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreditAmount, ownsPayment, creditsForCatalogPrice, parsePriceAllowlist, loadBillingConfig, keyMode } from "../server/billing-policy.ts";

const user = { id: "user-a", tenantId: 1, stripeCustomerId: "customer-a" };
const session = { customer: "customer-a", metadata: { userId: "user-a", tenantId: "1" } };
const config = { accountId: "acct_123", mode: "test" as const, prices: [{ priceId: "price_A", productId: "prod_A", credits: 5 }] };
const price = { id: "price_A", active: true, type: "one_time", unit_amount: 1999, currency: "usd", product: "prod_A", livemode: false };
const product = { id: "prod_A", active: true, metadata: { type: "review_credits", credits: "5" } };

test("payment ownership requires matching user, customer and tenant", () => {
  assert.equal(ownsPayment(user, session), true);
  assert.equal(ownsPayment(user, { ...session, customer: "other" }), false);
  assert.equal(ownsPayment(user, { ...session, metadata: { ...session.metadata, tenantId: "2" } }), false);
  assert.equal(ownsPayment(user, { ...session, metadata: { ...session.metadata, userId: "other" } }), false);
  assert.equal(ownsPayment(user, { ...session, metadata: null }), false);
});

test("credits must be canonical positive bounded integers", () => {
  for (const v of [null, undefined, "0", "-1", "1.5", "1foo", "1e5", "1000000", 1]) assert.equal(parseCreditAmount(v), null);
  assert.equal(parseCreditAmount("25"), 25);
});

test("allowlist entries must reference fixed catalog packages", () => {
  assert.deepEqual(parsePriceAllowlist("price_A:prod_A:5, price_B:prod_B:25"), [
    { priceId: "price_A", productId: "prod_A", credits: 5 }, { priceId: "price_B", productId: "prod_B", credits: 25 }]);
  for (const bad of [undefined, "", "price_A:prod_A:7", "price_A:prod_A:5:x", "foo:prod_A:5", "price_A:prod_A:5,price_A:prod_B:1", "price_A:prod_A:1000"]) {
    assert.equal(parsePriceAllowlist(bad), null, String(bad));
  }
});

test("billing config pins account, mode and live-charging opt-in", () => {
  const env = { STRIPE_ACCOUNT_ID: "acct_123", STRIPE_MODE: "test", STRIPE_CREDIT_PRICES: "price_A:prod_A:5" };
  assert.deepEqual(loadBillingConfig(env), config);
  assert.equal(loadBillingConfig({ ...env, STRIPE_ACCOUNT_ID: "nope" }), null);
  assert.equal(loadBillingConfig({ ...env, STRIPE_MODE: "prod" }), null);
  assert.equal(loadBillingConfig({ ...env, STRIPE_MODE: "live" }), null);
  assert.equal(loadBillingConfig({ ...env, STRIPE_MODE: "live", STRIPE_LIVE_CHARGING_ENABLED: "true" })?.mode, "live");
  assert.equal(keyMode("sk_live_x"), "live");
  assert.equal(keyMode("rk_test_x"), "test");
  assert.equal(keyMode("pk_test_x"), null);
});

test("only an exact allow-listed catalog price grants credits", () => {
  assert.equal(creditsForCatalogPrice(price, product, config), 5);
  const reject = (p: object, pr: object = product) => assert.equal(creditsForCatalogPrice({ ...price, ...p }, { ...product, ...pr }, config), null);
  reject({ id: "price_other" });
  reject({ product: "prod_other" });
  reject({ active: false });
  reject({ type: "recurring" });
  reject({ unit_amount: 1 });
  reject({ currency: "eur" });
  reject({ livemode: true });
  reject({}, { active: false });
  reject({}, { metadata: { type: "review_credits", credits: "500" } });
  reject({}, { metadata: { type: "unrelated", credits: "5" } });
});
