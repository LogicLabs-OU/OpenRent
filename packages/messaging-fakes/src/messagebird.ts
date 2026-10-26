import { createHash, createHmac, randomBytes } from 'node:crypto';
import { serve, type Reply, type Req } from './server.ts';

/**
 * The MessageBird SMS REST API: `POST /messages` with `Authorization: AccessKey {key}` and JSON
 * `{ recipients, originator, body, reportUrl, reference }`. As MessageBird does: recipients are MSISDNs
 * (digits, no plus), the originator is a number or at most 11 letters and digits, the body has at
 * most 1377 characters, and errors come as `{ errors: [{ code, description, parameter }] }`. Status
 * reports are GET requests to `reportUrl` signed with a `MessageBird-Signature-JWT` header.
 */
export interface MessageBirdMessage {
  id: string;
  recipients: string[];
  originator: string;
  body: string;
  reportUrl: string | null;
  reference: string | null;
  status: string;
}

export interface MessageBirdFake {
  url: string;
  accessKey: string;
  signingKey: string;
  messages: MessageBirdMessage[];
  /** Sends a signed status report for a message, as MessageBird would. */
  report(id: string, status: 'sent' | 'delivered' | 'delivery_failed' | 'expired', opts?: { signingKey?: string }): Promise<Response>;
  close(): Promise<void>;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** A MessageBird request signature: an HS256 JWT over the request URL (and body when there is one). */
export function messageBirdJwt(signingKey: string, url: string, body = '') {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { iss: 'MessageBird', nbf: now - 1, exp: now + 300, jti: randomBytes(8).toString('hex'), url_hash: createHash('sha256').update(url).digest('hex') };
  if (body) claims.payload_hash = createHash('sha256').update(body).digest('hex');
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${head}.${payload}.${createHmac('sha256', signingKey).update(`${head}.${payload}`).digest('base64url')}`;
}

const err = (status: number, code: number, description: string, parameter: string | null = null): Reply => ({ status, body: { errors: [{ code, description, parameter }] } });

export async function startMessageBirdFake(opts: { accessKey?: string; signingKey?: string } = {}): Promise<MessageBirdFake> {
  const accessKey = opts.accessKey ?? `test_${randomBytes(12).toString('hex')}`;
  const signingKey = opts.signingKey ?? randomBytes(16).toString('hex');
  const messages: MessageBirdMessage[] = [];

  const handle = (req: Req): Reply => {
    if (req.headers.authorization !== `AccessKey ${accessKey}`) return err(401, 2, 'Request not allowed (incorrect access_key)', 'access_key');
    if (req.method !== 'POST' || req.path !== '/messages') return err(404, 20, 'message not found');
    let b: any;
    try {
      b = JSON.parse(req.raw);
    } catch {
      return err(422, 9, 'invalid json');
    }
    const recipients: string[] = (Array.isArray(b.recipients) ? b.recipients : String(b.recipients ?? '').split(',')).map((r: unknown) => String(r).trim()).filter(Boolean);
    if (!recipients.length || recipients.some((r) => !/^[1-9]\d{6,14}$/.test(r))) return err(422, 9, 'no (correct) recipients found', 'recipients');
    const originator = String(b.originator ?? '');
    if (!/^(\+?\d{1,16}|[A-Za-z0-9 ]{1,11})$/.test(originator) || !/[A-Za-z0-9]/.test(originator)) return err(422, 9, 'originator is invalid', 'originator');
    const body = String(b.body ?? '');
    if (!body) return err(422, 9, 'body is required', 'body');
    if (body.length > 1377) return err(422, 9, 'body is too long', 'body');
    const m: MessageBirdMessage = { id: randomBytes(16).toString('hex'), recipients, originator, body, reportUrl: b.reportUrl ?? null, reference: b.reference ?? null, status: 'sent' };
    messages.push(m);
    return {
      status: 201,
      body: { id: m.id, href: `https://rest.messagebird.com/messages/${m.id}`, direction: 'mt', type: 'sms', originator, body, reference: m.reference, createdDatetime: new Date().toISOString(), recipients: { totalCount: recipients.length, totalSentCount: recipients.length, items: recipients.map((r) => ({ recipient: Number(r), status: 'sent' })) } },
    };
  };

  const srv = await serve(handle);
  return {
    url: srv.url, accessKey, signingKey, messages, close: srv.close,
    async report(id, status, o = {}) {
      const m = messages.find((x) => x.id === id);
      if (!m?.reportUrl) throw new Error(`no report URL for ${id}`);
      m.status = status;
      const q = new URLSearchParams({ id, reference: m.reference ?? '', recipient: m.recipients[0]!, status, statusDatetime: new Date().toISOString() });
      const url = `${m.reportUrl}${m.reportUrl.includes('?') ? '&' : '?'}${q}`;
      return fetch(url, { method: 'GET', headers: { 'messagebird-signature-jwt': messageBirdJwt(o.signingKey ?? signingKey, url) } });
    },
  };
}
