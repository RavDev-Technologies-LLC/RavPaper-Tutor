import type Stripe from 'stripe';
import { getStripeSync, getVerifiedStripe } from './stripeClient';
import { handleStripeEvent } from './fulfillment';
import { db } from './db';
import { sql } from 'drizzle-orm';

export class WebhookSignatureError extends Error {}

async function webhookSecret(accountId: string): Promise<string> {
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;
  // Fall back to the secret of the webhook endpoint managed by stripe-replit-sync.
  const result = await db.execute(sql`SELECT secret FROM "stripe"."_managed_webhooks" WHERE account_id = ${accountId} LIMIT 1`).catch(() => null);
  const secret = (result?.rows?.[0] as any)?.secret;
  if (!secret) throw new Error('No Stripe webhook secret configured (STRIPE_WEBHOOK_SECRET)');
  return secret;
}

export class WebhookHandlers {
  /**
   * Verify the Stripe signature, enforce account/mode pinning, then fulfil credits
   * idempotently. The verified event is also forwarded to stripe-replit-sync so the
   * mirrored `stripe.*` tables stay current.
   */
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) throw new Error('Stripe webhook payload must be the raw request body');
    const { stripe, config } = await getVerifiedStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, await webhookSecret(config.accountId));
    } catch {
      throw new WebhookSignatureError('Invalid Stripe signature');
    }
    // Direct (non-Connect) integration: events must come from the pinned account in the pinned mode.
    if (event.livemode !== (config.mode === 'live') || (event.account && event.account !== config.accountId)) {
      throw new WebhookSignatureError('Event does not belong to the configured Stripe account/mode');
    }

    await handleStripeEvent(stripe, event, config);

    if (process.env.STRIPE_SYNC_MIRROR === 'off') return;
    try {
      const sync = await getStripeSync();
      await sync.processEvent(event);
    } catch (e) {
      console.error(JSON.stringify({ event: 'stripe_sync_mirror_failed', stripeEvent: event.id }));
    }
  }
}
