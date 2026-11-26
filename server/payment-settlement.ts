import type Stripe from "stripe";
import { storage } from "./storage";
import { getUncachableStripeClient } from "./stripeClient";
import { ownsPayment, parseCreditAmount, validCatalogPrice } from "./billing-policy";

export type CheckoutSettlementResult =
  | { success: true; credits: number; alreadyProcessed: boolean }
  | { success: false; reason: "not_paid" | "forbidden" | "invalid" };

export function isCreditSettlementEvent(eventType: string): boolean {
  return eventType === "checkout.session.completed" ||
    eventType === "checkout.session.async_payment_succeeded";
}

export async function settleCheckoutSession(
  sessionId: string,
  expectedUserId?: string,
): Promise<CheckoutSettlementResult> {
  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { success: false, reason: "not_paid" };
  }
  if (
    session.mode !== "payment" ||
    session.livemode ||
    !session.amount_total ||
    session.currency !== "usd"
  ) {
    return { success: false, reason: "invalid" };
  }

  const metadata = session.metadata;
  const userId = metadata?.userId;
  const tenantId = metadata?.tenantId;
  const productId = metadata?.productId;
  const priceId = metadata?.priceId;
  const credits = parseCreditAmount(metadata?.credits);
  if (!userId || !tenantId || !productId || !priceId || credits === null) {
    return { success: false, reason: "invalid" };
  }
  if (expectedUserId && expectedUserId !== userId) {
    return { success: false, reason: "forbidden" };
  }

  const user = await storage.getUser(userId);
  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id ?? null;
  if (
    !user ||
    !user.isActive ||
    !ownsPayment(user, { customer: customerId, metadata }) ||
    user.tenantId === null ||
    String(user.tenantId) !== tenantId
  ) {
    return { success: false, reason: "forbidden" };
  }

  const [lineItems, price, product] = await Promise.all([
    stripe.checkout.sessions.listLineItems(session.id, { limit: 2 }),
    stripe.prices.retrieve(priceId),
    stripe.products.retrieve(productId),
  ]);
  const item = lineItems.data[0];
  if (
    lineItems.has_more ||
    lineItems.data.length !== 1 ||
    !item ||
    item.quantity !== 1 ||
    item.amount_total !== session.amount_total ||
    item.price?.id !== priceId ||
    (typeof price.product === "string" ? price.product : price.product.id) !== productId ||
    !validCatalogPrice(
      { ...price, product: typeof price.product === "string" ? price.product : price.product.id },
      product,
    ) ||
    price.unit_amount !== session.amount_total ||
    parseCreditAmount(product.metadata.credits) !== credits
  ) {
    return { success: false, reason: "invalid" };
  }

  const { user: updatedUser, alreadyProcessed } = await storage.addCredits(
    user.id,
    credits,
    `Purchased ${credits} review credit${credits > 1 ? "s" : ""}`,
    session.id,
  );
  if (!alreadyProcessed) {
    await storage.createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "credits_purchased",
      resourceType: "credits",
      resourceId: session.id,
      details: { credits, sessionId: session.id },
      ipAddress: null,
    });
  }

  return {
    success: true,
    credits: updatedUser.reviewCredits,
    alreadyProcessed,
  };
}

export async function settleCheckoutEvent(event: Stripe.Event): Promise<void> {
  if (!isCreditSettlementEvent(event.type)) return;

  const session = event.data.object as Stripe.Checkout.Session;
  await settleCheckoutSession(session.id);
}
