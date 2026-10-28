import Stripe from 'stripe';
import type {
  AuthorizeInput,
  AuthorizeResult,
  CaptureResult,
  CreatePaymentIntentInput,
  PaymentIntentResult,
  PaymentLinkInput,
  PaymentLinkResult,
  PaymentProvider,
  ProviderContext,
  ProviderEvent,
  RefundResult,
  WebhookRequest,
} from '@openrent/plugin-sdk';

/** The slice of the Stripe client this provider uses; tests pass a fake. */
export interface StripeLike {
  customers: { create(p: any, o?: any): Promise<{ id: string }> };
  paymentIntents: {
    create(p: any, o?: any): Promise<any>;
    retrieve(id: string, p?: any, o?: any): Promise<any>;
    capture(id: string, p?: any, o?: any): Promise<any>;
    cancel(id: string, p?: any, o?: any): Promise<any>;
  };
  refunds: { create(p: any, o?: any): Promise<any> };
  checkout: { sessions: { create(p: any, o?: any): Promise<{ id: string; url: string | null; expires_at?: number }> } };
  webhooks: { constructEvent(payload: Buffer | string, header: string, secret: string): any };
}

export type StripeFactory = (secretKey: string) => StripeLike;

const clients = new Map<string, StripeLike>();
export const defaultFactory: StripeFactory = (key) => {
  let c = clients.get(key);
  if (!c) {
    c = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: 'OpenRent', url: 'https://openrent.dev' } }) as unknown as StripeLike;
    clients.set(key, c);
  }
  return c;
};

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
/** The booking in a payment's metadata; a customer invoice without one has none (plugin API 1.9). */
const orderMeta = (input: { orderId: string | null; orderNumber: number | null }) =>
  input.orderId ? { order_id: input.orderId, ...(input.orderNumber != null ? { order_number: String(input.orderNumber) } : {}) } : {};

function mapIntentStatus(s: string): PaymentIntentResult['status'] {
  switch (s) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
      return 'processing';
    case 'requires_capture':
      return 'requires_capture';
    case 'canceled':
      return 'cancelled';
    default:
      return 'requires_payment';
  }
}

export function createStripeProvider(factory: StripeFactory = defaultFactory): PaymentProvider {
  const client = (ctx: ProviderContext) => {
    const key = str(ctx.config.secret_key);
    if (!key) throw new Error('Stripe is not configured: set secret_key');
    return factory(key);
  };
  const idem = (ctx: ProviderContext, suffix: string) => (ctx.idempotencyKey ? { idempotencyKey: `${ctx.idempotencyKey}:${suffix}` } : undefined);

  return {
    id: 'stripe',
    displayName: 'Stripe',
    // Card authorisations made online are valid for 7 days on Stripe (PRD §12.3).
    authorizationWindowDays: 7,

    isConfigured(ctx) {
      return !!str(ctx.config.secret_key) && !!str(ctx.config.publishable_key);
    },

    publicConfig(ctx) {
      return { publishable_key: str(ctx.config.publishable_key) };
    },

    // Stripe.js and the Payment Element (https://docs.stripe.com/security/guide#content-security-policy).
    cspSources() {
      return {
        script: ['https://js.stripe.com'],
        frame: ['https://js.stripe.com', 'https://hooks.stripe.com'],
        connect: ['https://api.stripe.com'],
      };
    },

    async createPaymentIntent(ctx, input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
      const stripe = client(ctx);
      let customerRef = input.customer.providerRef ?? null;
      if (!customerRef) {
        const c = await stripe.customers.create(
          { name: input.customer.name, email: input.customer.email ?? undefined, metadata: { openrent_customer_id: input.customer.id, tenant_id: ctx.tenantId } },
          idem(ctx, `customer:${input.customer.id}`),
        );
        customerRef = c.id;
      }
      const pi = await stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          customer: customerRef,
          description: input.description,
          automatic_payment_methods: { enabled: true },
          // Keep the card for the off-session deposit hold before pickup.
          ...(input.savePaymentMethod ? { setup_future_usage: 'off_session' } : {}),
          metadata: { ...input.metadata, ...orderMeta(input), purpose: input.purpose, tenant_id: ctx.tenantId },
        },
        idem(ctx, `pi:${input.reference ?? input.orderId}:${input.purpose}:${input.amount}`),
      );
      return { ref: pi.id, clientSecret: pi.client_secret ?? null, status: mapIntentStatus(pi.status), customerRef };
    },

    async createPaymentLink(ctx, input: PaymentLinkInput): Promise<PaymentLinkResult> {
      // Stripe Checkout pages live 30 minutes to 24 hours.
      const max = Date.now() + 23.5 * 3600_000;
      const expires = input.expiresAt ? Math.min(input.expiresAt.getTime(), max) : max;
      const metadata = { ...input.metadata, ...orderMeta(input), purpose: input.orderId ? 'rental' : 'invoice', tenant_id: ctx.tenantId };
      const session = await client(ctx).checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amount, product_data: { name: input.description } } }],
          ...(input.customer.providerRef ? { customer: input.customer.providerRef } : input.customer.email ? { customer_email: input.customer.email } : {}),
          // The payment intent carries the metadata, so the usual payment webhook settles the request.
          payment_intent_data: { metadata, description: input.description },
          metadata,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: Math.floor(Math.max(expires, Date.now() + 31 * 60_000) / 1000),
        },
        idem(ctx, `link:${input.metadata?.payment_request_id ?? input.reference ?? input.orderId}:${input.amount}`),
      );
      return { ref: session.id, url: session.url!, expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null };
    },

    async authorize(ctx, input: AuthorizeInput): Promise<AuthorizeResult> {
      const stripe = client(ctx);
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount: input.amount,
            currency: input.currency.toLowerCase(),
            customer: input.customerRef,
            payment_method: input.paymentMethodRef,
            capture_method: 'manual',
            off_session: true,
            confirm: true,
            description: input.description,
            metadata: { ...input.metadata, ...(input.orderId ? { order_id: input.orderId } : {}), purpose: input.metadata?.purpose ?? 'deposit', tenant_id: ctx.tenantId },
          },
          idem(ctx, `deposit:${input.reference ?? input.orderId}:${input.amount}`),
        );
        if (pi.status === 'requires_capture') {
          return { ref: pi.id, status: 'held', expiresAt: new Date(Date.now() + 7 * 86400_000) };
        }
        return { ref: pi.id, status: pi.status === 'requires_action' ? 'requires_action' : 'failed', expiresAt: null, error: pi.status };
      } catch (err: any) {
        return { ref: err?.raw?.payment_intent?.id ?? '', status: 'failed', expiresAt: null, error: err?.code ?? err?.message ?? 'authorization_failed' };
      }
    },

    async capture(ctx, ref, amount): Promise<CaptureResult> {
      const pi = await client(ctx).paymentIntents.capture(ref, { amount_to_capture: amount }, idem(ctx, `capture:${ref}:${amount}`));
      if (pi.status !== 'succeeded') return { status: 'failed', amountCaptured: 0 };
      const captured = Number(pi.amount_received ?? amount);
      return { status: captured < Number(pi.amount) ? 'partially_captured' : 'captured', amountCaptured: captured };
    },

    async void(ctx, ref) {
      await client(ctx).paymentIntents.cancel(ref, {}, idem(ctx, `cancel:${ref}`));
    },

    async refund(ctx, ref, amount): Promise<RefundResult> {
      const r = await client(ctx).refunds.create({ payment_intent: ref, amount }, idem(ctx, `refund:${ref}:${amount}`));
      return { ref: r.id, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending' };
    },

    async handleWebhook(ctx, req: WebhookRequest): Promise<ProviderEvent> {
      const secret = str(ctx.config.webhook_secret);
      if (!secret) throw Object.assign(new Error('Stripe webhook secret is not configured'), { status: 400, code: 'webhook_not_configured' });
      const header = req.headers['stripe-signature'];
      const sig = Array.isArray(header) ? header[0] : header;
      if (!sig) throw Object.assign(new Error('Missing Stripe-Signature header'), { status: 400, code: 'invalid_signature' });
      let event: any;
      try {
        event = client(ctx).webhooks.constructEvent(req.rawBody, sig, secret);
      } catch (err: any) {
        throw Object.assign(new Error(`Invalid Stripe signature: ${err?.message ?? err}`), { status: 400, code: 'invalid_signature' });
      }
      return mapEvent(event);
    },

    async retrievePayment(ctx, ref): Promise<ProviderEvent> {
      const pi = await client(ctx).paymentIntents.retrieve(ref);
      return mapIntentState(pi);
    },
  };
}

/** A PaymentIntent's current state as the event Stripe would send for it (stable id per state). */
export function mapIntentState(pi: any): ProviderEvent {
  const type =
    pi.status === 'succeeded'
      ? 'payment_intent.succeeded'
      : pi.status === 'requires_capture'
        ? 'payment_intent.amount_capturable_updated'
        : pi.status === 'canceled'
          ? 'payment_intent.canceled'
          : pi.status === 'requires_payment_method' && pi.last_payment_error
            ? 'payment_intent.payment_failed'
            : `payment_intent.${pi.status}`;
  return mapEvent({ id: `sync_${pi.id}_${pi.status}`, type, data: { object: pi } });
}

/** Maps Stripe events to provider-independent events. Exported for tests. */
export function mapEvent(event: any): ProviderEvent {
  const o = event?.data?.object ?? {};
  const meta = o.metadata ?? {};
  const orderId = str(meta.order_id);
  const purpose = (str(meta.purpose) ?? 'rental') as any;
  switch (event.type) {
    case 'payment_intent.succeeded':
      return {
        type: 'payment.succeeded', eventId: event.id, ref: o.id, amount: Number(o.amount_received ?? o.amount), currency: String(o.currency ?? '').toUpperCase(),
        orderId, purpose, customerRef: str(o.customer), paymentMethodRef: str(typeof o.payment_method === 'string' ? o.payment_method : o.payment_method?.id),
        paymentRequestId: str(meta.payment_request_id),
      };
    case 'payment_intent.amount_capturable_updated':
      return { type: 'authorization.held', eventId: event.id, ref: o.id, amount: Number(o.amount_capturable ?? o.amount), orderId, expiresAt: null };
    case 'payment_intent.payment_failed':
      return { type: 'payment.failed', eventId: event.id, ref: o.id, orderId, error: o.last_payment_error?.message ?? 'payment failed' };
    case 'payment_intent.canceled':
      return { type: 'payment.cancelled', eventId: event.id, ref: o.id, orderId };
    case 'refund.updated':
    case 'refund.created':
      if (o.status === 'succeeded') return { type: 'refund.succeeded', eventId: event.id, ref: o.id, paymentRef: str(o.payment_intent) ?? '', amount: Number(o.amount) };
      return { type: 'ignored', eventId: event.id, providerType: event.type };
    default:
      return { type: 'ignored', eventId: event.id, providerType: event.type };
  }
}
