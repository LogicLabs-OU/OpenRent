import { json, majorOf, minorOf, nextId, serve, type FakeHttp, type FakeReply, type FakeRequest } from './server.ts';

/**
 * A stateful stand-in for the Mollie Payments API (v2) with the rules from Mollie's documentation: a
 * `test_`/`live_` API key as bearer token; amounts as `{ currency, value }` with the currency's decimals;
 * payments `open` until the customer pays on the checkout page; `sequenceType: first` needs a customer
 * and leaves a mandate once paid, `recurring` needs a valid mandate and has no checkout; `captureMode:
 * manual` authorises first, captures only `authorized` payments, at most the amount; only open or
 * authorised payments can be cancelled; refunds only of paid payments, at most what is left. Webhooks
 * carry nothing but the payment id (`id=tr_…`), so the shop must fetch the payment to learn its state.
 */
export type MollieStatus = 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed';

export interface MolliePayment {
  id: string;
  amount: { currency: string; value: string };
  minor: number;
  description: string;
  status: MollieStatus;
  sequenceType: 'oneoff' | 'first' | 'recurring';
  captureMode: 'automatic' | 'manual';
  customerId: string | null;
  mandateId: string | null;
  redirectUrl: string | null;
  webhookUrl: string | null;
  metadata: unknown;
  captured: number;
  refunds: { id: string; minor: number; status: 'pending' | 'refunded' }[];
}

export interface MollieFake extends FakeHttp {
  apiKey: string;
  payments: MolliePayment[];
  customers: { id: string; name: string; email: string | null; mandates: { id: string; status: 'valid' | 'invalid'; method: string }[] }[];
  /** The customer pays on the checkout page (or fails, or gives up). */
  checkout(paymentId: string, outcome?: 'paid' | 'failed' | 'canceled'): MolliePayment;
  /** A pending refund goes through. */
  completeRefund(refundId: string): void;
}

const err = (status: number, title: string, detail: string, field?: string): FakeReply => json(status, { status, title, detail, ...(field ? { field } : {}) });

export async function startMollieFake(opts: { apiKey?: string } = {}): Promise<MollieFake> {
  const apiKey = opts.apiKey ?? 'test_fakefakefakefakefakefakefakefa';
  const payments: MolliePayment[] = [];
  const customers: MollieFake['customers'] = [];
  let base = '';

  const view = (p: MolliePayment) => ({
    resource: 'payment', id: p.id, mode: apiKey.startsWith('live_') ? 'live' : 'test', status: p.status, amount: p.amount, description: p.description,
    sequenceType: p.sequenceType, captureMode: p.captureMode, customerId: p.customerId, mandateId: p.mandateId, metadata: p.metadata, redirectUrl: p.redirectUrl, webhookUrl: p.webhookUrl,
    amountRefunded: { currency: p.amount.currency, value: majorOf(p.refunds.reduce((s, r) => s + r.minor, 0), p.amount.currency) },
    amountRemaining: { currency: p.amount.currency, value: majorOf(p.minor - p.refunds.reduce((s, r) => s + r.minor, 0), p.amount.currency) },
    isCancelable: p.status === 'open' || p.status === 'authorized',
    _links: { self: { href: `${base}/v2/payments/${p.id}` }, ...(p.status === 'open' && p.sequenceType !== 'recurring' ? { checkout: { href: `${base}/checkout/${p.id}` } } : {}) },
  });
  const refundView = (p: MolliePayment, r: MolliePayment['refunds'][number]) => ({ resource: 'refund', id: r.id, paymentId: p.id, status: r.status, amount: { currency: p.amount.currency, value: majorOf(r.minor, p.amount.currency) } });

  const handle = (req: FakeRequest): FakeReply => {
    if (req.path.startsWith('/checkout/')) return json(200, { page: 'Mollie checkout', payment: req.path.split('/').pop() });
    if (req.headers.authorization !== `Bearer ${apiKey}`) return err(401, 'Unauthorized Request', 'Missing authentication, or failed to authenticate');
    const [, v2, res, id, sub] = req.path.split('/');
    if (v2 !== 'v2') return err(404, 'Not Found', 'The resource does not exist');
    const b = req.body ?? {};

    if (res === 'customers' && req.method === 'POST' && !id) {
      const c = { id: nextId('cst_'), name: String(b.name ?? ''), email: b.email ?? null, mandates: [] };
      customers.push(c);
      return json(201, { resource: 'customer', id: c.id, name: c.name, email: c.email });
    }
    if (res === 'customers' && id && sub === 'mandates' && req.method === 'GET') {
      const c = customers.find((x) => x.id === id);
      if (!c) return err(404, 'Not Found', 'No customer exists with token ' + id);
      return json(200, { count: c.mandates.length, _embedded: { mandates: c.mandates.map((m) => ({ resource: 'mandate', ...m })) } });
    }
    if (res !== 'payments') return err(404, 'Not Found', 'The resource does not exist');

    if (req.method === 'POST' && !id) {
      const currency = String(b.amount?.currency ?? '');
      const minor = minorOf(b.amount?.value, currency);
      if (!currency || minor === null || minor <= 0) return err(422, 'Unprocessable Entity', 'The amount is invalid', 'amount');
      if (!b.description) return err(422, 'Unprocessable Entity', 'The description is invalid', 'description');
      const sequenceType = b.sequenceType ?? 'oneoff';
      const customer = b.customerId ? customers.find((c) => c.id === b.customerId) : null;
      if (b.customerId && !customer) return err(422, 'Unprocessable Entity', 'The customer id is invalid', 'customerId');
      if (sequenceType === 'first' && !customer) return err(422, 'Unprocessable Entity', 'A first payment needs a customer', 'customerId');
      if (sequenceType !== 'recurring' && !b.redirectUrl) return err(422, 'Unprocessable Entity', 'The redirect URL is invalid', 'redirectUrl');
      let mandateId: string | null = null;
      if (sequenceType === 'recurring') {
        const m = customer?.mandates.find((x) => x.status === 'valid' && (!b.mandateId || x.id === b.mandateId));
        if (!m) return err(422, 'Unprocessable Entity', 'The customer has no valid mandate', 'mandateId');
        mandateId = m.id;
      }
      const manual = b.captureMode === 'manual';
      const p: MolliePayment = {
        id: nextId('tr_'), amount: { currency, value: b.amount.value }, minor, description: b.description, sequenceType, captureMode: manual ? 'manual' : 'automatic',
        customerId: customer?.id ?? null, mandateId, redirectUrl: b.redirectUrl ?? null, webhookUrl: b.webhookUrl ?? null, metadata: b.metadata ?? null, captured: 0, refunds: [],
        // A recurring payment needs no customer: it is charged at once on the mandate.
        status: sequenceType === 'recurring' ? (manual ? 'authorized' : 'paid') : 'open',
      };
      if (p.status === 'paid') p.captured = p.minor;
      payments.push(p);
      return json(201, view(p));
    }
    const p = payments.find((x) => x.id === id);
    if (!p) return err(404, 'Not Found', `No payment exists with token ${id}.`);
    if (req.method === 'GET' && !sub) return json(200, view(p));
    if (req.method === 'GET' && sub === 'refunds') return json(200, { count: p.refunds.length, _embedded: { refunds: p.refunds.map((r) => refundView(p, r)) } });
    if (req.method === 'DELETE' && !sub) {
      if (p.status !== 'open' && p.status !== 'authorized') return err(422, 'Unprocessable Entity', 'The payment cannot be canceled');
      p.status = 'canceled';
      return json(200, view(p));
    }
    if (req.method === 'POST' && sub === 'captures') {
      if (p.status !== 'authorized') return err(422, 'Unprocessable Entity', 'Only authorized payments can be captured');
      const minor = b.amount ? minorOf(b.amount.value, p.amount.currency) : p.minor;
      if (minor === null || minor <= 0 || minor > p.minor) return err(422, 'Unprocessable Entity', 'The capture amount is invalid', 'amount');
      p.captured = minor;
      p.status = 'paid';
      return json(201, { resource: 'capture', id: nextId('cpt_'), paymentId: p.id, status: 'succeeded', amount: { currency: p.amount.currency, value: majorOf(minor, p.amount.currency) } });
    }
    if (req.method === 'POST' && sub === 'refunds') {
      if (p.status !== 'paid') return err(422, 'Unprocessable Entity', 'Only paid payments can be refunded');
      const minor = minorOf(b.amount?.value, p.amount.currency);
      const left = p.captured - p.refunds.reduce((s, r) => s + r.minor, 0);
      if (minor === null || minor <= 0 || minor > left) return err(422, 'Unprocessable Entity', 'The amount is higher than the amount that can be refunded', 'amount');
      const r = { id: nextId('re_'), minor, status: 'pending' as const };
      p.refunds.push(r);
      return json(201, refundView(p, r));
    }
    return err(404, 'Not Found', 'The resource does not exist');
  };

  const http = await serve(handle);
  base = http.url;
  const fake = http as MollieFake;
  fake.apiKey = apiKey;
  fake.payments = payments;
  fake.customers = customers;
  fake.checkout = (paymentId, outcome = 'paid') => {
    const p = payments.find((x) => x.id === paymentId)!;
    if (p.status !== 'open') throw new Error(`payment ${p.id} is ${p.status}`);
    if (outcome !== 'paid') {
      p.status = outcome;
      return p;
    }
    p.status = p.captureMode === 'manual' ? 'authorized' : 'paid';
    if (p.status === 'paid') p.captured = p.minor;
    if (p.sequenceType === 'first' && p.customerId) {
      const m = { id: nextId('mdt_'), status: 'valid' as const, method: 'creditcard' };
      customers.find((c) => c.id === p.customerId)!.mandates.push(m);
      p.mandateId = m.id;
    }
    return p;
  };
  fake.completeRefund = (refundId) => {
    for (const p of payments) for (const r of p.refunds) if (r.id === refundId) r.status = 'refunded';
  };
  return fake;
}
