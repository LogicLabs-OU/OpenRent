/**
 * Live check of the Mollie and PayPal plugins against the real APIs, in test mode only. Opt-in: a
 * provider is checked only when its variables are set. Each check creates one payment for 1.00 EUR,
 * prints the page a customer would pay on, reads it back and cancels it where the API allows. Nothing
 * is charged: nobody pays on the page.
 *
 *   MOLLIE_API_KEY=test_...                                       (a Mollie test key)
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=...                 (a PayPal sandbox app)
 *
 *   pnpm test:payments-live
 */
import type { PaymentProvider, ProviderContext } from '@openrent/plugin-sdk';
import { createMollieProvider } from '@openrent/plugin-payment-mollie';
import { createPayPalProvider } from '@openrent/plugin-payment-paypal';

const env = (k: string) => process.env[k]?.trim() ?? '';
const logger = { info() {}, warn() {}, error: console.error, debug() {} };
const checks: { name: string; provider: PaymentProvider; vars: string[]; config: Record<string, unknown> }[] = [
  { name: 'Mollie', provider: createMollieProvider(), vars: ['MOLLIE_API_KEY'], config: { api_key: env('MOLLIE_API_KEY') } },
  { name: 'PayPal', provider: createPayPalProvider(), vars: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'], config: { client_id: env('PAYPAL_CLIENT_ID'), client_secret: env('PAYPAL_CLIENT_SECRET'), environment: 'sandbox' } },
];

async function check(c: (typeof checks)[number]) {
  if (c.name === 'Mollie' && !env('MOLLIE_API_KEY').startsWith('test_')) throw new Error('use a test_ key: this check never touches live payments');
  const ctx: ProviderContext = { tenantId: 'live-check', config: c.config, logger, webhookUrl: 'https://example.com/webhooks/live-check' };
  const r = await c.provider.createPaymentIntent(ctx, {
    amount: 100, currency: 'EUR', orderId: 'live-check', orderNumber: 1, purpose: 'rental', customer: { id: 'live', name: 'OpenRent live check', email: null, providerRef: null },
    savePaymentMethod: false, description: 'OpenRent live check (cancelled)', metadata: {}, returnUrl: 'https://example.com/order/live-check',
  });
  console.log(`  created ${r.ref}; pay page ${r.redirectUrl}`);
  const state = await c.provider.retrievePayment!(ctx, r.ref);
  console.log(`  read back: ${state.type}`);
  await c.provider.void(ctx, r.ref);
  console.log('  cancelled');
}

let ran = 0;
let failed = 0;
for (const c of checks) {
  if (!c.vars.every((k) => env(k))) {
    console.log(`${c.name}: skipped (set ${c.vars.join(', ')})`);
    continue;
  }
  ran++;
  console.log(`${c.name}:`);
  try {
    await check(c);
    console.log('  ok');
  } catch (e) {
    failed++;
    console.log(`  FAILED: ${(e as Error).message}`);
  }
}
if (!ran) console.log('Nothing to check: no credentials set.');
process.exit(failed ? 1 : 0);
