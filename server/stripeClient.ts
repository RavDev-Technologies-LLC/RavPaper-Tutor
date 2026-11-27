import { keyMode, loadBillingConfig, type BillingConfig } from './billing-policy';
import Stripe from 'stripe';

let connectionSettings: any;

async function getCredentials() {
  // Outside Replit, keys may be supplied directly.
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY) {
    return { publishableKey: process.env.STRIPE_PUBLISHABLE_KEY, secretKey: process.env.STRIPE_SECRET_KEY };
  }
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });

  if (!response.ok) throw new Error('Stripe connection unavailable');
  const data = await response.json();
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}

export class BillingUnavailableError extends Error {}

let verified: { key: string; config: BillingConfig } | null = null;
let clientFactory: ((secretKey: string) => Stripe) | null = null;

/** Test hook: substitute the Stripe client used for pinned operations. */
export function setStripeClientFactory(factory: ((secretKey: string) => Stripe) | null) {
  if (process.env.NODE_ENV === 'production') throw new Error('Not available in production');
  clientFactory = factory;
  verified = null;
}

/**
 * Stripe client pinned to the configured account and mode (STRIPE_ACCOUNT_ID, STRIPE_MODE).
 * Refuses to operate if the connected key belongs to a different account or mode.
 */
export async function getVerifiedStripe(): Promise<{ stripe: Stripe; config: BillingConfig }> {
  const config = loadBillingConfig();
  if (!config) throw new BillingUnavailableError("Billing is not configured (STRIPE_ACCOUNT_ID, STRIPE_MODE, STRIPE_CREDIT_PRICES)");
  const { secretKey } = await getCredentials();
  if (keyMode(secretKey) !== config.mode) throw new BillingUnavailableError("Stripe key mode does not match STRIPE_MODE");
  const stripe = clientFactory ? clientFactory(secretKey) : new Stripe(secretKey, { apiVersion: '2025-08-27.basil' as any });
  if (!verified || verified.key !== secretKey || verified.config.accountId !== config.accountId) {
    const account = await stripe.accounts.retrieve();
    if (account.id !== config.accountId) throw new BillingUnavailableError("Stripe key belongs to an unexpected account");
    verified = { key: secretKey, config };
  }
  return { stripe, config };
}
