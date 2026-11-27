import { catalogPackage, CREDIT_CURRENCY } from "@shared/credit-catalog";

export type StripeMode = "test" | "live";
export type AllowedPrice = { priceId: string; productId: string; credits: number };
export type BillingConfig = { accountId: string; mode: StripeMode; prices: AllowedPrice[] };

export function parseCreditAmount(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/**
 * Parse STRIPE_CREDIT_PRICES: comma-separated `price_id:prod_id:credits` entries.
 * Every entry must reference a catalog package; ids must be unique.
 */
export function parsePriceAllowlist(raw: string | undefined): AllowedPrice[] | null {
  if (!raw || !raw.trim()) return null;
  const out: AllowedPrice[] = [];
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [priceId, productId, creditsRaw, ...rest] = entry.split(":");
    const credits = parseCreditAmount(creditsRaw);
    if (rest.length || !/^price_[A-Za-z0-9]+$/.test(priceId ?? "") || !/^prod_[A-Za-z0-9]+$/.test(productId ?? "") || credits === null || !catalogPackage(credits)) return null;
    out.push({ priceId, productId, credits });
  }
  const ids = new Set(out.map((p) => p.priceId));
  return out.length && ids.size === out.length ? out : null;
}

/** Derive mode from the secret key prefix so a test key can never serve a live configuration (and vice versa). */
export function keyMode(secretKey: string): StripeMode | null {
  if (/^(sk|rk)_live_/.test(secretKey)) return "live";
  if (/^(sk|rk)_test_/.test(secretKey)) return "test";
  return null;
}

export function loadBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig | null {
  const accountId = env.STRIPE_ACCOUNT_ID;
  const mode = env.STRIPE_MODE;
  const prices = parsePriceAllowlist(env.STRIPE_CREDIT_PRICES);
  if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId) || (mode !== "test" && mode !== "live") || !prices) return null;
  if (mode === "live" && env.STRIPE_LIVE_CHARGING_ENABLED !== "true") return null;
  return { accountId, mode, prices };
}

export function ownsPayment(user: { id: string; tenantId: number | null; stripeCustomerId: string | null }, session: { customer: string | null; metadata: Record<string, string> | null }): boolean {
  return user.tenantId !== null && !!user.stripeCustomerId && session.customer === user.stripeCustomerId &&
    session.metadata?.userId === user.id && session.metadata?.tenantId === String(user.tenantId);
}

type PriceLike = { id: string; active: boolean; type: string; unit_amount: number | null; currency: string; product: string; livemode: boolean };
type ProductLike = { id: string; active: boolean; metadata: Record<string, string> };

/**
 * Returns the number of credits a price grants, or null if it is not an exact,
 * allow-listed, active, one-time catalog price in the pinned mode.
 */
export function creditsForCatalogPrice(price: PriceLike, product: ProductLike, config: BillingConfig): number | null {
  const allowed = config.prices.find((p) => p.priceId === price.id);
  if (!allowed || allowed.productId !== product.id || price.product !== product.id) return null;
  const pkg = catalogPackage(allowed.credits);
  if (!pkg) return null;
  const ok = price.active && product.active && price.type === "one_time" && price.currency === CREDIT_CURRENCY &&
    price.livemode === (config.mode === "live") && price.unit_amount === pkg.unitAmount &&
    product.metadata.type === "review_credits" && product.metadata.credits === String(allowed.credits);
  return ok ? allowed.credits : null;
}
