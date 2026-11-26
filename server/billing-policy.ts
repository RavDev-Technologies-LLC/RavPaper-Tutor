export function parseCreditAmount(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
export function ownsPayment(user: { id: string; tenantId: number | null; stripeCustomerId: string | null }, session: { customer: string | null; metadata: Record<string, string> | null }): boolean {
  return user.tenantId !== null && !!user.stripeCustomerId && session.customer === user.stripeCustomerId &&
    session.metadata?.userId === user.id && session.metadata?.tenantId === String(user.tenantId);
}
export function validCatalogPrice(price: { active: boolean; type: string; unit_amount: number | null; currency: string; product: string }, product: { id: string; active: boolean; metadata: Record<string, string> }): boolean {
  return price.active && product.active && price.product === product.id && price.type === "one_time" &&
    price.unit_amount !== null && Number.isSafeInteger(price.unit_amount) && price.unit_amount > 0 &&
    price.currency === "usd" && product.metadata.type === "review_credits" && parseCreditAmount(product.metadata.credits) !== null;
}
