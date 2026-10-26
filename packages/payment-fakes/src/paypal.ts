import { randomUUID } from 'node:crypto';
import { json, majorOf, minorOf, nextId, serve, type FakeHttp, type FakeReply, type FakeRequest } from './server.ts';

/**
 * A stateful stand-in for the PayPal REST API (Orders v2, Payments v2) with the rules from PayPal's
 * documentation: OAuth 2 client credentials with expiring tokens; amounts as `{ currency_code, value }`;
 * an order waits for the buyer (`PAYER_ACTION_REQUIRED`) until approved, then is captured (intent
 * CAPTURE) or authorised (AUTHORIZE) once; a vaulted PayPal account (`vault_id`) pays without the buyer;
 * authorisations are captured or voided once; refunds at most what was captured; repeated calls with
 * the same PayPal-Request-Id return the first answer; webhooks are checked with verify-webhook-signature.
 */
export interface PayPalOrder {
  id: string;
  intent: 'CAPTURE' | 'AUTHORIZE';
  status: 'CREATED' | 'PAYER_ACTION_REQUIRED' | 'APPROVED' | 'COMPLETED' | 'VOIDED';
  currency: string;
  minor: number;
  customId: string | null;
  referenceId: string | null;
  returnUrl: string | null;
  vault: 'requested' | null;
  vaultId: string | null;
  captures: { id: string; minor: number; status: 'COMPLETED' | 'DECLINED'; refunds: { id: string; minor: number }[] }[];
  authorizations: { id: string; minor: number; status: 'CREATED' | 'CAPTURED' | 'VOIDED' }[];
}

export interface PayPalFake extends FakeHttp {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  orders: PayPalOrder[];
  /** The buyer approves the order on PayPal's page. */
  approve(orderId: string): PayPalOrder;
  /** Headers PayPal would sign a webhook with; only these verify. */
  webhookHeaders(): Record<string, string>;
  /** The next capture is declined. */
  declineNext(): void;
}

const err = (status: number, name: string, issue: string, description = issue): FakeReply => json(status, { name, message: description, details: [{ issue, description }] });

export async function startPayPalFake(opts: { clientId?: string; clientSecret?: string; webhookId?: string } = {}): Promise<PayPalFake> {
  const clientId = opts.clientId ?? 'pp-client';
  const clientSecret = opts.clientSecret ?? 'pp-secret';
  const webhookId = opts.webhookId ?? 'WH-FAKE';
  const tokens = new Map<string, number>();
  const orders: PayPalOrder[] = [];
  const replies = new Map<string, FakeReply>();
  const vaults = new Map<string, string>();
  let decline = false;
  let base = '';

  const amount = (minor: number, currency: string) => ({ currency_code: currency, value: majorOf(minor, currency) });
  const view = (o: PayPalOrder) => ({
    id: o.id, intent: o.intent, status: o.status,
    purchase_units: [{
      reference_id: o.referenceId, custom_id: o.customId, amount: amount(o.minor, o.currency),
      payments: {
        captures: o.captures.map((c) => ({ id: c.id, status: c.refunds.reduce((s, r) => s + r.minor, 0) >= c.minor ? 'REFUNDED' : c.status, amount: amount(c.minor, o.currency), custom_id: o.customId, supplementary_data: { related_ids: { order_id: o.id } } })),
        authorizations: o.authorizations.map((a) => ({ id: a.id, status: a.status, amount: amount(a.minor, o.currency), custom_id: o.customId })),
      },
    }],
    payment_source: { paypal: { email_address: 'buyer@example.com', ...(o.vaultId ? { attributes: { vault: { id: o.vaultId, status: 'VAULTED', customer: { id: vaults.get(o.vaultId) } } } } : {}) } },
    links: o.status === 'PAYER_ACTION_REQUIRED' ? [{ rel: 'payer-action', href: `${base}/checkoutnow?token=${o.id}`, method: 'GET' }] : [{ rel: 'self', href: `${base}/v2/checkout/orders/${o.id}`, method: 'GET' }],
  });
  const findCapture = (id: string) => {
    for (const o of orders) for (const c of o.captures) if (c.id === id) return { o, c };
    return null;
  };
  const capture = (o: PayPalOrder, minor: number) => {
    const c = { id: nextId('CAP'), minor, status: (decline ? 'DECLINED' : 'COMPLETED') as 'COMPLETED' | 'DECLINED', refunds: [] };
    decline = false;
    o.captures.push(c);
    return c;
  };

  const handle = (req: FakeRequest): FakeReply => {
    if (req.path === '/checkoutnow') return json(200, { page: 'PayPal approval', token: req.query.get('token') });
    if (req.path === '/v1/oauth2/token' && req.method === 'POST') {
      const basic = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      if (basic !== `${clientId}:${clientSecret}`) return json(401, { error: 'invalid_client', error_description: 'Client Authentication failed' });
      if (req.body?.grant_type !== 'client_credentials') return json(400, { error: 'unsupported_grant_type' });
      const t = `A21AA${randomUUID().replace(/-/g, '')}`;
      tokens.set(t, Date.now() + 32400_000);
      return json(200, { access_token: t, token_type: 'Bearer', expires_in: 32400 });
    }
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!tokens.has(token) || tokens.get(token)! < Date.now()) return json(401, { error: 'invalid_token', error_description: 'Token signature verification failed' });
    // Idempotency: the same request id answers the same.
    const rid = req.headers['paypal-request-id'] ? `${req.path}:${req.headers['paypal-request-id']}` : null;
    if (rid && replies.has(rid)) return replies.get(rid)!;
    const out = route(req);
    if (rid && out.status < 300) replies.set(rid, out);
    return out;
  };

  const route = (req: FakeRequest): FakeReply => {
    const b = req.body ?? {};
    const p = req.path;
    if (p === '/v1/notifications/verify-webhook-signature' && req.method === 'POST') {
      const ok = b.webhook_id === webhookId && b.transmission_sig === 'fake-signature' && b.auth_algo === 'SHA256withRSA' && !!b.webhook_event;
      return json(200, { verification_status: ok ? 'SUCCESS' : 'FAILURE' });
    }
    if (p === '/v2/checkout/orders' && req.method === 'POST') {
      const unit = b.purchase_units?.[0];
      const currency = String(unit?.amount?.currency_code ?? '');
      const minor = minorOf(unit?.amount?.value, currency);
      if (!['CAPTURE', 'AUTHORIZE'].includes(b.intent)) return err(400, 'INVALID_REQUEST', 'INVALID_PARAMETER_VALUE', 'intent');
      if (b.purchase_units?.length !== 1 || !currency || minor === null || minor <= 0) return err(422, 'UNPROCESSABLE_ENTITY', 'DECIMAL_PRECISION', 'The amount value is invalid');
      if (unit.custom_id && String(unit.custom_id).length > 127) return err(400, 'INVALID_REQUEST', 'INVALID_STRING_LENGTH', 'custom_id');
      const paypal = b.payment_source?.paypal ?? {};
      const vaultId: string | null = paypal.vault_id ?? null;
      if (vaultId && !vaults.has(vaultId)) return err(422, 'UNPROCESSABLE_ENTITY', 'INVALID_VAULT_ID');
      const o: PayPalOrder = {
        id: nextId('5O'), intent: b.intent, status: vaultId ? 'COMPLETED' : 'PAYER_ACTION_REQUIRED', currency, minor, customId: unit.custom_id ?? null, referenceId: unit.reference_id ?? null,
        returnUrl: paypal.experience_context?.return_url ?? null, vault: paypal.attributes?.vault?.store_in_vault === 'ON_SUCCESS' ? 'requested' : null, vaultId, captures: [], authorizations: [],
      };
      if (!vaultId && !o.returnUrl) return err(422, 'UNPROCESSABLE_ENTITY', 'MISSING_RETURN_URL');
      // A vaulted buyer pays without being there.
      if (vaultId) {
        if (o.intent === 'CAPTURE') capture(o, minor);
        else o.authorizations.push({ id: nextId('AUTH'), minor, status: 'CREATED' });
      }
      orders.push(o);
      return json(vaultId ? 201 : 200, view(o));
    }
    const m = /^\/v2\/checkout\/orders\/([^/]+)(?:\/(capture|authorize))?$/.exec(p);
    if (m) {
      const o = orders.find((x) => x.id === m[1]);
      if (!o) return err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (req.method === 'GET' && !m[2]) return json(200, view(o));
      if (req.method === 'POST' && m[2]) {
        if (o.status === 'COMPLETED') return err(422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_CAPTURED');
        if (o.status !== 'APPROVED') return err(422, 'UNPROCESSABLE_ENTITY', 'ORDER_NOT_APPROVED');
        if ((m[2] === 'capture') !== (o.intent === 'CAPTURE')) return err(422, 'UNPROCESSABLE_ENTITY', 'ACTION_DOES_NOT_MATCH_INTENT');
        if (m[2] === 'capture') capture(o, o.minor);
        else o.authorizations.push({ id: nextId('AUTH'), minor: o.minor, status: 'CREATED' });
        o.status = 'COMPLETED';
        if (o.vault === 'requested') {
          o.vaultId = nextId('VLT');
          vaults.set(o.vaultId, nextId('CUST'));
        }
        return json(201, view(o));
      }
    }
    const a = /^\/v2\/payments\/authorizations\/([^/]+)\/(capture|void)$/.exec(p);
    if (a && req.method === 'POST') {
      const o = orders.find((x) => x.authorizations.some((y) => y.id === a[1]));
      const auth = o?.authorizations.find((y) => y.id === a[1]);
      if (!o || !auth) return err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (auth.status !== 'CREATED') return err(422, 'UNPROCESSABLE_ENTITY', a[2] === 'capture' ? 'AUTHORIZATION_ALREADY_CAPTURED' : 'PREVIOUSLY_VOIDED');
      if (a[2] === 'void') {
        auth.status = 'VOIDED';
        return json(200, { id: auth.id, status: 'VOIDED' });
      }
      const minor = b.amount ? minorOf(b.amount.value, o.currency) : auth.minor;
      if (minor === null || minor <= 0 || minor > auth.minor) return err(422, 'UNPROCESSABLE_ENTITY', 'AMOUNT_CANNOT_BE_SPECIFIED');
      auth.status = 'CAPTURED';
      const c = capture(o, minor);
      return json(201, { id: c.id, status: c.status, amount: amount(minor, o.currency) });
    }
    const r = /^\/v2\/payments\/captures\/([^/]+)(\/refund)?$/.exec(p);
    if (r) {
      const found = findCapture(r[1]!);
      if (!found) return err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (req.method === 'GET' && !r[2]) return json(200, { id: found.c.id, status: found.c.status, amount: amount(found.c.minor, found.o.currency), custom_id: found.o.customId, supplementary_data: { related_ids: { order_id: found.o.id } } });
      if (req.method === 'POST' && r[2]) {
        if (found.c.status !== 'COMPLETED') return err(422, 'UNPROCESSABLE_ENTITY', 'CAPTURE_STATUS_NOT_VALID');
        const left = found.c.minor - found.c.refunds.reduce((s, x) => s + x.minor, 0);
        const minor = b.amount ? minorOf(b.amount.value, found.o.currency) : left;
        if (minor === null || minor <= 0 || minor > left) return err(422, 'UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED');
        const ref = { id: nextId('RF'), minor };
        found.c.refunds.push(ref);
        return json(201, { id: ref.id, status: 'COMPLETED', amount: amount(minor, found.o.currency), links: [{ rel: 'up', href: `${base}/v2/payments/captures/${found.c.id}` }] });
      }
    }
    return err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
  };

  const http = await serve(handle);
  base = http.url;
  const fake = http as PayPalFake;
  Object.assign(fake, {
    clientId, clientSecret, webhookId, orders,
    approve(orderId: string) {
      const o = orders.find((x) => x.id === orderId)!;
      if (o.status !== 'PAYER_ACTION_REQUIRED') throw new Error(`order ${o.id} is ${o.status}`);
      o.status = 'APPROVED';
      return o;
    },
    webhookHeaders: () => ({
      'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': `${base}/certs/fake.pem`, 'paypal-transmission-id': randomUUID(),
      'paypal-transmission-sig': 'fake-signature', 'paypal-transmission-time': new Date().toISOString(),
    }),
    declineNext: () => void (decline = true),
  });
  return fake;
}
