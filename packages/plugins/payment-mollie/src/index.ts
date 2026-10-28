import {
  definePlugin,
  type AuthorizeResult,
  type CaptureResult,
  type PaymentIntentResult,
  type PaymentProvider,
  type ProviderContext,
  type ProviderEvent,
  type RefundResult,
} from '@openrent/plugin-sdk';

/**
 * Mollie payments (PRD M2): the customer pays on Mollie's checkout page (cards, iDEAL, Bancontact, SEPA
 * and the other methods enabled on the Mollie profile) and comes back to the booking. A first payment
 * leaves a mandate, which later pays deposits held off-session (manual capture) and long-rental periods.
 * Mollie webhooks carry only the payment id; the plugin fetches the payment with the shop's key, so a
 * forged webhook cannot change anything.
 */
const API = 'https://api.mollie.com';
const ZERO_DECIMALS = new Set(['JPY', 'KRW', 'ISK', 'HUF', 'TWD']);
const decimals = (currency: string) => (ZERO_DECIMALS.has(currency.toUpperCase()) ? 0 : 2);
export const mollieAmount = (minor: number, currency: string) => ({ currency: currency.toUpperCase(), value: (minor / 10 ** decimals(currency)).toFixed(decimals(currency)) });
export const minorAmount = (a: { currency: string; value: string } | undefined) => (a ? Math.round(Number(a.value) * 10 ** decimals(a.currency)) : 0);
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

async function call(ctx: ProviderContext, method: string, path: string, body?: unknown) {
  const key = str(ctx.config.api_key);
  if (!key) throw new Error('Mollie is not configured: set api_key');
  const res = await fetch(`${str(ctx.config.api_base_url) ?? API}/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(ctx.idempotencyKey && method === 'POST' ? { 'idempotency-key': `${ctx.idempotencyKey}:${path}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Mollie: ${data.detail ?? data.title ?? `HTTP ${res.status}`}`), { status: res.status, field: data.field });
  return data;
}

function intentStatus(s: string): PaymentIntentResult['status'] {
  return s === 'paid' ? 'succeeded' : s === 'authorized' ? 'requires_capture' : s === 'pending' ? 'processing' : s === 'canceled' || s === 'expired' ? 'cancelled' : s === 'failed' ? 'failed' : 'requires_payment';
}

/** A Mollie payment's state as an event; the id is stable per state, so a repeated webhook is ignored. */
export function mapPayment(p: any): ProviderEvent {
  const meta = (p.metadata && typeof p.metadata === 'object' ? p.metadata : {}) as Record<string, string>;
  const orderId = str(meta.order_id);
  const eventId = `${p.id}:${p.status}`;
  switch (p.status) {
    case 'paid':
      return {
        type: 'payment.succeeded', eventId, ref: p.id, amount: minorAmount(p.amount), currency: String(p.amount?.currency ?? '').toUpperCase(), orderId, purpose: (str(meta.purpose) ?? 'rental') as any,
        customerRef: str(p.customerId), paymentMethodRef: str(p.mandateId), paymentRequestId: str(meta.payment_request_id),
      };
    case 'authorized':
      return { type: 'authorization.held', eventId, ref: p.id, amount: minorAmount(p.amount), orderId, expiresAt: null };
    case 'failed':
    case 'expired':
      return { type: 'payment.failed', eventId, ref: p.id, orderId, error: `Mollie payment ${p.status}` };
    case 'canceled':
      return { type: 'payment.cancelled', eventId, ref: p.id, orderId };
    default:
      return { type: 'ignored', eventId, providerType: `payment.${p.status}` };
  }
}

export function createMollieProvider(): PaymentProvider {
  return {
    id: 'mollie',
    displayName: 'Mollie',
    // Card authorisations are good for about a week; the deposit policy renews them before then.
    authorizationWindowDays: 7,
    isConfigured: (ctx) => /^(test|live)_\w{20,}$/.test(String(ctx.config.api_key ?? '')),
    // Everything happens on Mollie's page: nothing for the browser.
    publicConfig: () => ({}),

    async createPaymentIntent(ctx, input): Promise<PaymentIntentResult> {
      let customerRef = input.customer.providerRef ?? null;
      if (!customerRef && input.savePaymentMethod) {
        customerRef = (await call(ctx, 'POST', '/customers', { name: input.customer.name, email: input.customer.email ?? undefined, metadata: { openrent_customer_id: input.customer.id } })).id;
      }
      const p = await call(ctx, 'POST', '/payments', {
        amount: mollieAmount(input.amount, input.currency),
        description: (input.description ?? (input.orderNumber != null ? `#${input.orderNumber}` : input.reference)).slice(0, 255),
        redirectUrl: input.returnUrl,
        webhookUrl: ctx.webhookUrl,
        metadata: { ...input.metadata, ...(input.orderId ? { order_id: input.orderId } : {}), purpose: input.purpose, tenant_id: ctx.tenantId },
        // A first payment leaves a mandate for deposits and later periods.
        ...(input.savePaymentMethod && customerRef ? { sequenceType: 'first', customerId: customerRef } : customerRef ? { customerId: customerRef } : {}),
      });
      return { ref: p.id, clientSecret: null, status: intentStatus(p.status), customerRef, redirectUrl: p._links?.checkout?.href ?? null };
    },

    async authorize(ctx, input): Promise<AuthorizeResult> {
      try {
        const p = await call(ctx, 'POST', '/payments', {
          amount: mollieAmount(input.amount, input.currency), description: (input.description ?? 'Deposit').slice(0, 255), sequenceType: 'recurring', customerId: input.customerRef,
          mandateId: input.paymentMethodRef, captureMode: 'manual', webhookUrl: ctx.webhookUrl, metadata: { ...input.metadata, ...(input.orderId ? { order_id: input.orderId } : {}), purpose: input.metadata?.purpose ?? 'deposit', tenant_id: ctx.tenantId },
        });
        if (p.status === 'authorized') return { ref: p.id, status: 'held', expiresAt: new Date(Date.now() + 7 * 86400_000) };
        return { ref: p.id, status: 'failed', expiresAt: null, error: p.status };
      } catch (e) {
        return { ref: '', status: 'failed', expiresAt: null, error: (e as Error).message };
      }
    },

    async capture(ctx, ref, amount): Promise<CaptureResult> {
      const p = await call(ctx, 'GET', `/payments/${ref}`);
      const c = await call(ctx, 'POST', `/payments/${ref}/captures`, { amount: mollieAmount(amount, p.amount.currency) });
      if (c.status !== 'succeeded' && c.status !== 'pending') return { status: 'failed', amountCaptured: 0 };
      return { status: amount < minorAmount(p.amount) ? 'partially_captured' : 'captured', amountCaptured: amount };
    },

    async void(ctx, ref) {
      const p = await call(ctx, 'GET', `/payments/${ref}`);
      if (p.isCancelable) await call(ctx, 'DELETE', `/payments/${ref}`);
    },

    async refund(ctx, ref, amount): Promise<RefundResult> {
      const p = await call(ctx, 'GET', `/payments/${ref}`);
      const r = await call(ctx, 'POST', `/payments/${ref}/refunds`, { amount: mollieAmount(amount, p.amount.currency) });
      return { ref: r.id, status: r.status === 'refunded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending' };
    },

    async handleWebhook(ctx, req): Promise<ProviderEvent> {
      const id = new URLSearchParams(req.rawBody.toString('utf8')).get('id') ?? '';
      if (!/^tr_\w+$/.test(id)) throw Object.assign(new Error('Not a Mollie payment id'), { status: 400, code: 'invalid_webhook' });
      const p = await call(ctx, 'GET', `/payments/${id}`);
      // A refund that went through is told on the payment's webhook too.
      if (Number(p.amountRefunded?.value ?? 0) > 0) {
        const refunds = (await call(ctx, 'GET', `/payments/${id}/refunds`))._embedded?.refunds ?? [];
        const done = refunds.filter((r: any) => r.status === 'refunded').at(-1);
        if (done) return { type: 'refund.succeeded', eventId: `${done.id}:refunded`, ref: done.id, paymentRef: id, amount: minorAmount(done.amount) };
      }
      return mapPayment(p);
    },

    async retrievePayment(ctx, ref): Promise<ProviderEvent> {
      return mapPayment(await call(ctx, 'GET', `/payments/${ref}`));
    },
  };
}

export default definePlugin({
  id: 'payment-mollie',
  name: 'Mollie payments',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.5.0',
  permissions: ['payments:write', 'customers:read'],
  settings: [
    { key: 'api_key', label: 'API key', type: 'secret', required: true, help: 'test_... or live_... from Developers → API keys in the Mollie dashboard' },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ api_key: api.env('MOLLIE_API_KEY') });
    api.registerPaymentProvider(createMollieProvider());
  },
});
