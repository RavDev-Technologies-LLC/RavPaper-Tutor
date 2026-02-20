import { getUncachableStripeClient } from './stripeClient';

const CREDIT_PACKAGES = [
  { name: 'Single Review', description: '1 paper review credit', credits: 1, price: 499 },
  { name: '5 Review Pack', description: '5 paper review credits - Save 20%', credits: 5, price: 1999 },
  { name: '10 Review Pack', description: '10 paper review credits - Save 30%', credits: 10, price: 3499 },
  { name: '25 Review Bundle', description: '25 paper review credits - Save 40%', credits: 25, price: 7499 },
];

async function seedProducts() {
  const stripe = await getUncachableStripeClient();

  for (const pkg of CREDIT_PACKAGES) {
    const existing = await stripe.products.search({ query: `name:'${pkg.name}'` });
    if (existing.data.length > 0) {
      console.log(`Product "${pkg.name}" already exists, skipping.`);
      continue;
    }

    const product = await stripe.products.create({
      name: pkg.name,
      description: pkg.description,
      metadata: {
        type: 'review_credits',
        credits: String(pkg.credits),
      },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: pkg.price,
      currency: 'usd',
    });

    console.log(`Created: ${pkg.name} (${product.id}) - $${(pkg.price / 100).toFixed(2)} (${price.id})`);
  }

  console.log('Seed complete!');
}

seedProducts().catch(console.error);
