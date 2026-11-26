export function parseCreditAmount(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

const CREDIT_PACKAGE_PRICES: Readonly<Record<number, number>> = {
  1: 499,
  5: 1999,
  10: 3499,
  25: 7499,
};

export function ownsPayment(user: { id: string; tenantId: number | null; stripeCustomerId: string | null }, session: { customer: string | null; metadata: Record<string, string> | null }): boolean {
  return user.tenantId !== null && !!user.stripeCustomerId && session.customer === user.stripeCustomerId &&
    session.metadata?.userId === user.id && session.metadata?.tenantId === String(user.tenantId);
}

export function validCatalogPrice(
  price: { active: boolean; type: string; unit_amount: number | null; currency: string; product: string; livemode: boolean },
  product: { id: string; active: boolean; livemode: boolean; metadata: Record<string, string> },
): boolean {
  const credits = parseCreditAmount(product.metadata.credits);
  return price.active && product.active && !price.livemode && !product.livemode &&
    price.product === product.id && price.type === "one_time" &&
    price.unit_amount !== null && Number.isSafeInteger(price.unit_amount) &&
    price.currency === "usd" && product.metadata.type === "review_credits" &&
    credits !== null && CREDIT_PACKAGE_PRICES[credits] === price.unit_amount;
}
