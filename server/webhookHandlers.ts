import { getStripeSync } from './stripeClient';
import type Stripe from 'stripe';
import { settleCheckoutEvent } from './payment-settlement';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // processWebhook validates the signature before returning; only then trust this event body.
    const event = JSON.parse(payload.toString('utf8')) as Stripe.Event;
    await settleCheckoutEvent(event);
  }
}
