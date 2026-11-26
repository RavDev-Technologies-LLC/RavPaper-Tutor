import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreditAmount, ownsPayment, validCatalogPrice } from "../server/billing-policy.ts";
const user = { id: "user-a", tenantId: 1, stripeCustomerId: "customer-a" };
const session = { customer: "customer-a", metadata: { userId: "user-a", tenantId: "1" } };
const price = { active: true, type: "one_time", unit_amount: 499, currency: "usd", product: "product-a" };
const product = { id: "product-a", active: true, metadata: { type: "review_credits", credits: "1" } };
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
test("catalog price must belong to an active credit product and be a paid one-time USD price", () => {
  assert.equal(validCatalogPrice(price, product), true);
  assert.equal(validCatalogPrice({ ...price, product: "other" }, product), false);
  assert.equal(validCatalogPrice({ ...price, active: false }, product), false);
  assert.equal(validCatalogPrice({ ...price, type: "recurring" }, product), false);
  assert.equal(validCatalogPrice({ ...price, unit_amount: 0 }, product), false);
  assert.equal(validCatalogPrice({ ...price, currency: "eur" }, product), false);
  assert.equal(validCatalogPrice(price, { ...product, active: false }), false);
  assert.equal(validCatalogPrice(price, { ...product, metadata: { type: "unrelated", credits: "1" } }), false);
});
