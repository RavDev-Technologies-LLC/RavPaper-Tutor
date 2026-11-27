import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { stripeEvents } from "@shared/schema";
import { storage, PaymentOwnershipError } from "./storage";
import { ownsPayment, type BillingConfig } from "./billing-policy";
import { catalogPackage, CREDIT_CURRENCY } from "@shared/credit-catalog";

export type FulfillmentResult =
  | { status: "fulfilled" | "already_fulfilled"; userId: string; credits: number; balance: number }
  | { status: "not_paid" }
  | { status: "rejected"; reason: string };

/**
 * Grant review credits for a paid Checkout Session exactly once.
 * Called from the signed webhook (authoritative) and from the post-redirect
 * verify endpoint (fallback); both paths converge on the same idempotent ledger write,
 * guarded by an advisory lock and a unique index on stripe_session_id.
 */
export async function fulfillCheckoutSession(stripe: Stripe, session: Stripe.Checkout.Session, config: BillingConfig, source: "webhook" | "client"): Promise<FulfillmentResult> {
  if (session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid") return { status: "not_paid" };
  if (session.livemode !== (config.mode === "live")) return { status: "rejected", reason: "mode_mismatch" };
  if (session.currency !== CREDIT_CURRENCY) return { status: "rejected", reason: "currency" };

  const md = session.metadata ?? {};
  const allowed = config.prices.find((p) => p.priceId === md.priceId);
  if (!allowed || allowed.productId !== md.productId) return { status: "rejected", reason: "price_not_allowlisted" };
  const pkg = catalogPackage(allowed.credits);
  if (!pkg || session.amount_total !== pkg.unitAmount) return { status: "rejected", reason: "amount_mismatch" };

  const user = md.userId ? await storage.getUser(md.userId) : undefined;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  if (!user || !ownsPayment(user, { customer, metadata: md })) return { status: "rejected", reason: "ownership" };

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
  const item = lineItems.data[0];
  const itemProduct = item?.price ? (typeof item.price.product === "string" ? item.price.product : item.price.product?.id) : undefined;
  if (lineItems.has_more || lineItems.data.length !== 1 || !item?.price || item.quantity !== 1 || item.price.id !== allowed.priceId ||
      itemProduct !== allowed.productId || item.amount_total !== pkg.unitAmount) {
    return { status: "rejected", reason: "line_items" };
  }

  const before = (await storage.getCreditTransactions(user.id)).some((t) => t.stripeSessionId === session.id);
  try {
    const { user: updated } = await storage.addCredits(user.id, allowed.credits,
      `Purchased ${allowed.credits} review credit${allowed.credits > 1 ? "s" : ""}`, session.id);
    if (!before) {
      await storage.createAuditLog({
        tenantId: user.tenantId, userId: user.id, action: "credits_purchased", resourceType: "credits",
        resourceId: session.id, details: { credits: allowed.credits, source }, ipAddress: null,
      });
    }
    return { status: before ? "already_fulfilled" : "fulfilled", userId: user.id, credits: allowed.credits, balance: updated.reviewCredits };
  } catch (e) {
    if (e instanceof PaymentOwnershipError) return { status: "rejected", reason: "ledger_conflict" };
    throw e;
  }
}

const FULFILLMENT_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/**
 * Record and process a verified Stripe event once. Returns false if it was already processed.
 * Failures are recorded and re-thrown so Stripe retries delivery.
 */
export async function handleStripeEvent(stripe: Stripe, event: Stripe.Event, config: BillingConfig): Promise<boolean> {
  await db.insert(stripeEvents).values({ id: event.id, type: event.type, livemode: event.livemode }).onConflictDoNothing();
  const claimed = await db.update(stripeEvents).set({ status: "processing" })
    .where(sql`${stripeEvents.id} = ${event.id} AND ${stripeEvents.status} <> 'processed'`).returning({ id: stripeEvents.id });
  if (!claimed.length) return false;
  try {
    if (FULFILLMENT_EVENTS.has(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      const result = await fulfillCheckoutSession(stripe, session, config, "webhook");
      if (result.status === "rejected") {
        console.error(JSON.stringify({ event: "stripe_fulfillment_rejected", stripeEvent: event.id, reason: result.reason }));
        await db.update(stripeEvents).set({ status: "rejected", error: result.reason, processedAt: new Date() }).where(eq(stripeEvents.id, event.id));
        return true;
      }
    }
    await db.update(stripeEvents).set({ status: "processed", error: null, processedAt: new Date() }).where(eq(stripeEvents.id, event.id));
    return true;
  } catch (e) {
    await db.update(stripeEvents).set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "error" }).where(eq(stripeEvents.id, event.id));
    throw e;
  }
}
