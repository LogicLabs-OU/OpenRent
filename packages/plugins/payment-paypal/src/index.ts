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
 * PayPal payments (PRD M2) with the Orders v2 API. The customer approves on PayPal's page and comes back
 * to the booking, where the order is captured. A booking with a deposit asks PayPal to keep the account
 * (vault), which later holds deposits off-session (intent AUTHORIZE) and pays long-rental periods.
 * OpenRent's reference is the PayPal order id; captures and authorisations are looked up from it.
 * Webhooks are checked with PayPal's verify-webhook-signature call.
 */
const LIVE = 'https://api-m.paypal.com';
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const ZERO_DECIMALS = new Set(['JPY', 'HUF', 'TWD']);
const decimals = (currency: string) => (ZERO_DECIMALS.has(currency.toUpperCase()) ? 0 : 2);
export const paypalAmount = (minor: number, currency: string) => ({ currency_code: currency.toUpperCase(), value: (minor / 10 ** decimals(currency)).toFixed(decimals(currency)) });
const minorOf = (a: { currency_code: string; value: string } | undefined) => (a ? Math.round(Number(a.value) * 10 ** decimals(a.currency_code)) : 0);
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

/** OpenRent's references in PayPal's 127-character custom_id: tenant, order, purpose, payment request. */
export function packRefs(r: { tenant: string; order: string; purpose: string; request?: string | null }) {
  return [r.tenant, r.order, r.purpose, r.request ?? ''].join('|');
}
export function unpackRefs(s: unknown) {
  const [tenant, order, purpose, request] = String(s ?? '').split('|');
  return { tenant: str(tenant), order: str(order), purpose: str(purpose) ?? 'rental', request: str(request) };
}

const base = (ctx: ProviderContext) => str(ctx.config.api_base_url) ?? (ctx.config.environment === 'live' ? LIVE : SANDBOX);
const tokens = new Map<string, { token: string; until: number }>();

async function token(ctx: ProviderContext) {
  const id = str(ctx.config.client_id);
  const secret = str(ctx.config.client_secret);
  if (!id || !secret) throw new Error('PayPal is not configured: set client_id and client_secret');
  const key = `${base(ctx)}:${id}`;
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const res = await fetch(`${base(ctx)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: 'grant_type=client_credentials',
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`PayPal sign-in failed: ${data.error_description ?? res.status}`);
  tokens.set(key, { token: data.access_token, until: Date.now() + Number(data.expires_in ?? 3600) * 1000 });
  return data.access_token as string;
}

async function call(ctx: ProviderContext, method: string, path: string, body?: unknown, requestId?: string) {
  const res = await fetch(`${base(ctx)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token(ctx)}`, accept: 'application/json', 'content-type': 'application/json', prefer: 'return=representation',
      ...(requestId ? { 'paypal-request-id': requestId.slice(0, 108) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`PayPal: ${data.details?.[0]?.issue ?? data.name ?? `HTTP ${res.status}`}`), { status: res.status, issue: data.details?.[0]?.issue });
  return data;
}

const unit = (o: any) => o.purchase_units?.[0] ?? {};
const captureOf = (o: any) => unit(o).payments?.captures?.[0] ?? null;
const authorizationOf = (o: any) => unit(o).payments?.authorizations?.[0] ?? null;

/** A PayPal order's state as an event; ids are stable per state. */
export function mapOrder(o: any): ProviderEvent {
  const refs = unpackRefs(unit(o).custom_id ?? captureOf(o)?.custom_id ?? authorizationOf(o)?.custom_id);
  const cap = captureOf(o);
  const auth = authorizationOf(o);
  const vault = o.payment_source?.paypal?.attributes?.vault;
  if (cap?.status === 'COMPLETED' || cap?.status === 'REFUNDED' || cap?.status === 'PARTIALLY_REFUNDED') {
    return {
      type: 'payment.succeeded', eventId: `${o.id}:captured`, ref: o.id, amount: minorOf(cap.amount), currency: cap.amount.currency_code, orderId: refs.order, purpose: refs.purpose as any,
      customerRef: str(vault?.customer?.id), paymentMethodRef: str(vault?.id), paymentRequestId: refs.request,
    };
  }
  if (cap?.status === 'DECLINED' || cap?.status === 'FAILED') return { type: 'payment.failed', eventId: `${o.id}:declined`, ref: o.id, orderId: refs.order, error: 'PayPal declined the payment' };
  if (auth?.status === 'CREATED') return { type: 'authorization.held', eventId: `${o.id}:authorized`, ref: o.id, amount: minorOf(auth.amount), orderId: refs.order, expiresAt: auth.expiration_time ? new Date(auth.expiration_time) : null };
  if (o.status === 'VOIDED' || auth?.status === 'VOIDED') return { type: 'payment.cancelled', eventId: `${o.id}:voided`, ref: o.id, orderId: refs.order };
  return { type: 'ignored', eventId: `${o.id}:${o.status}`, providerType: `order.${o.status}` };
}

/** An approved order is completed: captured, or authorised for intent AUTHORIZE. Repeats are harmless. */
async function complete(ctx: ProviderContext, o: any) {
  if (o.status !== 'APPROVED') return o;
  const action = o.intent === 'AUTHORIZE' ? 'authorize' : 'capture';
  return call(ctx, 'POST', `/v2/checkout/orders/${o.id}/${action}`, {}, `${action}:${o.id}`);
}

export function createPayPalProvider(): PaymentProvider {
  return {
    id: 'paypal',
    displayName: 'PayPal',
    // PayPal honours an authorisation for three days and keeps it for 29; deposits renew before then.
    authorizationWindowDays: 3,
    isConfigured: (ctx) => !!str(ctx.config.client_id) && !!str(ctx.config.client_secret),
    publicConfig: () => ({}),

    async createPaymentIntent(ctx, input): Promise<PaymentIntentResult> {
      const o = await call(
        ctx,
        'POST',
        '/v2/checkout/orders',
        {
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: input.orderId ?? input.reference, custom_id: packRefs({ tenant: ctx.tenantId, order: input.orderId ?? '', purpose: input.purpose, request: input.metadata?.payment_request_id }),
            description: (input.description ?? (input.orderNumber != null ? `#${input.orderNumber}` : input.reference)).slice(0, 127), amount: paypalAmount(input.amount, input.currency),
          }],
          payment_source: {
            paypal: {
              experience_context: { return_url: input.returnUrl, cancel_url: input.returnUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' },
              // Kept for deposits held later and periods of long rentals.
              ...(input.savePaymentMethod ? { attributes: { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT' } } } : {}),
            },
          },
        },
        ctx.idempotencyKey ? `${ctx.idempotencyKey}:order:${input.reference ?? input.orderId}:${input.amount}` : undefined,
      );
      const approve = (o.links ?? []).find((l: any) => l.rel === 'payer-action' || l.rel === 'approve');
      return { ref: o.id, clientSecret: null, status: 'requires_payment', redirectUrl: approve?.href ?? null };
    },

    async authorize(ctx, input): Promise<AuthorizeResult> {
      try {
        const o = await call(ctx, 'POST', '/v2/checkout/orders', {
          intent: 'AUTHORIZE',
          purchase_units: [{ reference_id: input.orderId ?? input.reference ?? '', custom_id: packRefs({ tenant: ctx.tenantId, order: input.orderId ?? '', purpose: input.metadata?.purpose ?? 'deposit' }), description: (input.description ?? 'Deposit').slice(0, 127), amount: paypalAmount(input.amount, input.currency) }],
          payment_source: { paypal: { vault_id: input.paymentMethodRef } },
        }, ctx.idempotencyKey ? `${ctx.idempotencyKey}:authorize` : undefined);
        const auth = authorizationOf(o);
        if (auth?.status === 'CREATED') return { ref: o.id, status: 'held', expiresAt: auth.expiration_time ? new Date(auth.expiration_time) : new Date(Date.now() + 3 * 86400_000) };
        return { ref: o.id, status: 'failed', expiresAt: null, error: auth?.status ?? o.status };
      } catch (e) {
        return { ref: '', status: 'failed', expiresAt: null, error: (e as Error).message };
      }
    },

    async capture(ctx, ref, amount): Promise<CaptureResult> {
      const o = await call(ctx, 'GET', `/v2/checkout/orders/${ref}`);
      const auth = authorizationOf(o);
      if (!auth) return { status: 'failed', amountCaptured: 0 };
      const c = await call(ctx, 'POST', `/v2/payments/authorizations/${auth.id}/capture`, { amount: paypalAmount(amount, auth.amount.currency_code), final_capture: true }, `capture:${auth.id}:${amount}`);
      if (c.status !== 'COMPLETED' && c.status !== 'PENDING') return { status: 'failed', amountCaptured: 0 };
      return { status: amount < minorOf(auth.amount) ? 'partially_captured' : 'captured', amountCaptured: amount };
    },

    async void(ctx, ref) {
      const o = await call(ctx, 'GET', `/v2/checkout/orders/${ref}`);
      const auth = authorizationOf(o);
      // An order nobody approved simply expires at PayPal.
      if (auth?.status === 'CREATED') await call(ctx, 'POST', `/v2/payments/authorizations/${auth.id}/void`, {}, `void:${auth.id}`);
    },

    async refund(ctx, ref, amount): Promise<RefundResult> {
      const o = await call(ctx, 'GET', `/v2/checkout/orders/${ref}`);
      const cap = captureOf(o);
      if (!cap) return { ref: '', status: 'failed' };
      const r = await call(ctx, 'POST', `/v2/payments/captures/${cap.id}/refund`, { amount: paypalAmount(amount, cap.amount.currency_code) }, ctx.idempotencyKey ? `${ctx.idempotencyKey}:refund:${amount}` : `refund:${cap.id}:${amount}:${Date.now()}`);
      return { ref: r.id, status: r.status === 'COMPLETED' ? 'succeeded' : r.status === 'CANCELLED' || r.status === 'FAILED' ? 'failed' : 'pending' };
    },

    async handleWebhook(ctx, req): Promise<ProviderEvent> {
      const webhookId = str(ctx.config.webhook_id);
      if (!webhookId) throw Object.assign(new Error('PayPal webhook id is not configured'), { status: 400, code: 'webhook_not_configured' });
      let event: any;
      try {
        event = JSON.parse(req.rawBody.toString('utf8'));
      } catch {
        throw Object.assign(new Error('Malformed PayPal webhook'), { status: 400, code: 'invalid_webhook' });
      }
      const h = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      const check = await call(ctx, 'POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'), transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'), webhook_id: webhookId, webhook_event: event,
      });
      if (check.verification_status !== 'SUCCESS') throw Object.assign(new Error('Invalid PayPal webhook signature'), { status: 400, code: 'invalid_signature' });
      const r = event.resource ?? {};
      switch (event.event_type) {
        case 'CHECKOUT.ORDER.APPROVED':
          return mapOrder(await complete(ctx, await call(ctx, 'GET', `/v2/checkout/orders/${r.id}`)));
        case 'PAYMENT.CAPTURE.COMPLETED':
        case 'PAYMENT.CAPTURE.DENIED': {
          const orderId = r.supplementary_data?.related_ids?.order_id;
          return orderId ? mapOrder(await call(ctx, 'GET', `/v2/checkout/orders/${orderId}`)) : { type: 'ignored', eventId: event.id, providerType: event.event_type };
        }
        case 'PAYMENT.CAPTURE.REFUNDED': {
          const up = (r.links ?? []).find((l: any) => l.rel === 'up')?.href;
          const capture = up ? await call(ctx, 'GET', new URL(up).pathname) : null;
          const orderId = capture?.supplementary_data?.related_ids?.order_id;
          if (!orderId) return { type: 'ignored', eventId: event.id, providerType: event.event_type };
          return { type: 'refund.succeeded', eventId: event.id, ref: r.id, paymentRef: orderId, amount: minorOf(r.amount) };
        }
        default:
          return { type: 'ignored', eventId: event.id, providerType: String(event.event_type) };
      }
    },

    /** When the customer comes back from PayPal: an approved order is captured there and then. */
    async retrievePayment(ctx, ref): Promise<ProviderEvent> {
      return mapOrder(await complete(ctx, await call(ctx, 'GET', `/v2/checkout/orders/${ref}`)));
    },
  };
}

export default definePlugin({
  id: 'payment-paypal',
  name: 'PayPal payments',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.5.0',
  permissions: ['payments:write', 'customers:read'],
  settings: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true, help: 'From your app at developer.paypal.com' },
    { key: 'client_secret', label: 'Secret', type: 'secret', required: true },
    { key: 'webhook_id', label: 'Webhook ID', type: 'text', required: true, help: 'The id PayPal shows for the webhook URL below (events: checkout order approved, payment capture completed, denied and refunded)' },
    { key: 'environment', label: 'Accounts', type: 'select', options: ['sandbox', 'live'] },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ client_id: api.env('PAYPAL_CLIENT_ID'), client_secret: api.env('PAYPAL_CLIENT_SECRET'), webhook_id: api.env('PAYPAL_WEBHOOK_ID'), environment: api.env('PAYPAL_ENVIRONMENT') ?? 'sandbox' });
    api.registerPaymentProvider(createPayPalProvider());
  },
});
