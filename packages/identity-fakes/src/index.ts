import { createHmac, randomUUID } from 'node:crypto';
import { serve, type Server } from '@openrent/sign-fakes';

/**
 * Stand-ins for Stripe Identity and Veriff that enforce what each service requires (keys, signatures,
 * session states), for testing the ID check plugins without real accounts (FR-PAY-9).
 */

export interface StripeSession {
  id: string;
  object: 'identity.verification_session';
  status: 'requires_input' | 'processing' | 'verified' | 'canceled';
  type: string;
  url: string | null;
  return_url: string;
  metadata: Record<string, string>;
  last_error: { code: string; reason: string } | null;
}
export interface StripeIdentityFake extends Server {
  sessions: Map<string, StripeSession>;
  verify(id: string): void;
  fail(id: string, reason?: string): void;
  /** A webhook event for the session and its Stripe-Signature header. */
  webhook(id: string, secret: string): { body: string; signature: string };
}

export async function startStripeIdentityFake(opts: { secretKey: string }): Promise<StripeIdentityFake> {
  const sessions = new Map<string, StripeSession>();
  const server = await serve((req) => {
    if (req.headers.authorization !== `Bearer ${opts.secretKey}`) return { status: 401, body: { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } } };
    if (req.method === 'POST' && req.path === '/v1/identity/verification_sessions') {
      const b = req.body ?? {};
      if (b.type !== 'document' && b.type !== 'id_number') return { status: 400, body: { error: { type: 'invalid_request_error', param: 'type', message: 'type is required' } } };
      const id = `vs_${randomUUID().slice(0, 12)}`;
      const metadata = Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), String(v)]));
      const s: StripeSession = { id, object: 'identity.verification_session', status: 'requires_input', type: b.type, url: `https://verify.stripe.com/start/test_${id}`, return_url: String(b.return_url ?? ''), metadata, last_error: null };
      sessions.set(id, s);
      return { status: 200, body: s };
    }
    const m = /^\/v1\/identity\/verification_sessions\/([^/]+)$/.exec(req.path);
    if (req.method === 'GET' && m) {
      const s = sessions.get(m[1]!);
      return s ? { status: 200, body: s } : { status: 404, body: { error: { type: 'invalid_request_error', message: 'No such verification session' } } };
    }
    return { status: 404, body: { error: { message: 'not found' } } };
  });
  return {
    ...server,
    sessions,
    verify: (id) => Object.assign(sessions.get(id)!, { status: 'verified', url: null, last_error: null }),
    fail: (id, reason = 'The document is expired.') => Object.assign(sessions.get(id)!, { status: 'requires_input', last_error: { code: 'document_expired', reason } }),
    webhook: (id, secret) => {
      const s = sessions.get(id)!;
      const type = s.status === 'verified' ? 'identity.verification_session.verified' : s.status === 'canceled' ? 'identity.verification_session.canceled' : 'identity.verification_session.requires_input';
      const body = JSON.stringify({ id: `evt_${randomUUID().slice(0, 12)}`, object: 'event', type, data: { object: s } });
      const t = Math.floor(Date.now() / 1000);
      return { body, signature: `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}` };
    },
  };
}

export interface VeriffSession {
  id: string;
  url: string;
  vendorData: string | null;
  status: 'created' | 'approved' | 'declined' | 'resubmission_requested' | 'expired' | 'abandoned';
  reason: string | null;
  callback: string | null;
}
export interface VeriffFake extends Server {
  sessions: Map<string, VeriffSession>;
  approve(id: string): void;
  decline(id: string, reason?: string): void;
  /** The decision webhook body and its X-HMAC-SIGNATURE. */
  webhook(id: string): { body: string; signature: string };
}

export async function startVeriffFake(opts: { apiKey: string; secret: string }): Promise<VeriffFake> {
  const sessions = new Map<string, VeriffSession>();
  const sign = (data: string | Buffer) => createHmac('sha256', opts.secret).update(data).digest('hex');
  const decision = (s: VeriffSession) => ({ id: s.id, status: s.status, code: s.status === 'approved' ? 9001 : s.status === 'declined' ? 9102 : 9103, vendorData: s.vendorData, reason: s.reason });
  const server = await serve((req) => {
    if (req.headers['x-auth-client'] !== opts.apiKey) return { status: 401, body: { status: 'fail', code: 1801, message: 'Mandatory X-AUTH-CLIENT header containing the API key is missing from the request.' } };
    if (req.method === 'POST' && req.path === '/v1/sessions') {
      if (req.headers['x-hmac-signature'] !== sign(req.bytes)) return { status: 401, body: { status: 'fail', code: 1104, message: 'Signature is not valid' } };
      const v = req.body?.verification;
      if (!v || typeof v !== 'object') return { status: 400, body: { status: 'fail', code: 1102, message: 'verification is required' } };
      const id = randomUUID();
      const s: VeriffSession = { id, url: `https://alchemy.veriff.com/v/${id}`, vendorData: v.vendorData ?? null, status: 'created', reason: null, callback: v.callback ?? null };
      sessions.set(id, s);
      return { status: 201, body: { status: 'success', verification: { id, url: s.url, vendorData: s.vendorData, host: 'https://alchemy.veriff.com', status: 'created', sessionToken: 'tok' } } };
    }
    const m = /^\/v1\/sessions\/([^/]+)\/decision$/.exec(req.path);
    if (req.method === 'GET' && m) {
      if (req.headers['x-hmac-signature'] !== sign(m[1]!)) return { status: 401, body: { status: 'fail', code: 1104, message: 'Signature is not valid' } };
      const s = sessions.get(m[1]!);
      if (!s) return { status: 404, body: { status: 'fail', message: 'not found' } };
      return { status: 200, body: { status: 'success', verification: s.status === 'created' ? null : decision(s) } };
    }
    return { status: 404, body: { status: 'fail', message: 'not found' } };
  });
  return {
    ...server,
    sessions,
    approve: (id) => Object.assign(sessions.get(id)!, { status: 'approved' }),
    decline: (id, reason = 'Document is not valid') => Object.assign(sessions.get(id)!, { status: 'declined', reason }),
    webhook: (id) => {
      const body = JSON.stringify({ status: 'success', verification: decision(sessions.get(id)!), technicalData: { ip: '127.0.0.1' } });
      return { body, signature: sign(body) };
    },
  };
}
