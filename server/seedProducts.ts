// Create the fixed credit catalog in the connected Stripe account, then print the
// STRIPE_CREDIT_PRICES allowlist to configure. Idempotent: existing products are reused.
import Stripe from 'stripe';
import { getStripeSecretKey } from './stripeClient';
import { keyMode } from './billing-policy';
import { CREDIT_PACKAGES, CREDIT_CURRENCY } from '@shared/credit-catalog';

async function seedProducts() {
  const secretKey = await getStripeSecretKey();
  const stripe = new Stripe(secretKey, { apiVersion: '2025-08-27.basil' as any });
  const account = await stripe.accounts.retrieve();
  const entries: string[] = [];

  for (const pkg of CREDIT_PACKAGES) {
    const found = await stripe.products.search({ query: `metadata['type']:'review_credits' AND metadata['credits']:'${pkg.credits}' AND active:'true'` });
    const product = found.data[0] ?? await stripe.products.create({
      name: pkg.name, description: pkg.description, metadata: { type: 'review_credits', credits: String(pkg.credits) },
    }, { idempotencyKey: `ravpaper-product-${pkg.credits}` });

    const prices = await stripe.prices.list({ product: product.id, active: true, type: 'one_time', limit: 100 });
    const price = prices.data.find((p) => p.unit_amount === pkg.unitAmount && p.currency === CREDIT_CURRENCY) ?? await stripe.prices.create({
      product: product.id, unit_amount: pkg.unitAmount, currency: CREDIT_CURRENCY,
    }, { idempotencyKey: `ravpaper-price-${pkg.credits}-${pkg.unitAmount}` });

    console.log(`${pkg.name}: ${product.id} ${price.id} $${(pkg.unitAmount / 100).toFixed(2)}`);
    entries.push(`${price.id}:${product.id}:${pkg.credits}`);
  }

  console.log('\nConfigure these environment variables:');
  console.log(`STRIPE_ACCOUNT_ID=${account.id}`);
  console.log(`STRIPE_MODE=${keyMode(secretKey)}`);
  console.log(`STRIPE_CREDIT_PRICES=${entries.join(',')}`);
}

seedProducts().catch((e) => { console.error(e); process.exit(1); });
