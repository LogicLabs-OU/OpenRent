import { definePlugin } from '@openrent/plugin-sdk';
import { createStripeProvider } from './provider.ts';

export { createStripeProvider, mapEvent, mapIntentState } from './provider.ts';

/**
 * First-party Stripe payments (FR-PAY-1). Online payments with Payment Element, a saved card
 * for off-session deposit holds (manual capture), refunds and signed inbound webhooks.
 * Installation defaults come from STRIPE_* env variables; tenants can override in Settings → Payments.
 */
export default definePlugin({
  id: 'payment-stripe',
  name: 'Stripe payments',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.0.0',
  permissions: ['payments:write', 'customers:read'],
  settings: [
    { key: 'secret_key', label: 'Secret key', type: 'secret', required: true, help: 'sk_test_... or sk_live_...' },
    { key: 'publishable_key', label: 'Publishable key', type: 'text', required: true, help: 'pk_test_... or pk_live_...' },
    { key: 'webhook_secret', label: 'Webhook signing secret', type: 'secret', required: true, help: 'whsec_... from the Stripe dashboard or `stripe listen`' },
  ],
  setup(api) {
    api.setDefaultConfig({
      secret_key: api.env('STRIPE_SECRET_KEY'),
      publishable_key: api.env('STRIPE_PUBLISHABLE_KEY'),
      webhook_secret: api.env('STRIPE_WEBHOOK_SECRET'),
    });
    api.registerPaymentProvider(createStripeProvider());
  },
});
