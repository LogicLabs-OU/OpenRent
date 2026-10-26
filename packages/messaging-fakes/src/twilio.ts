import { createHmac, randomBytes } from 'node:crypto';
import { E164, serve, type Reply, type Req } from './server.ts';

/**
 * Twilio Programmable Messaging, the parts a booking app uses: `POST /2010-04-01/Accounts/{sid}/Messages.json`
 * with HTTP Basic auth (account SID and auth token) and a form body. As Twilio does: `To` must be E.164
 * (`whatsapp:` + E.164 for WhatsApp, with a `whatsapp:` sender), a sender is `From` or
 * `MessagingServiceSid`, `Body` holds at most 1600 characters unless `ContentSid` names a template,
 * numbers that texted STOP are refused (21610), and errors carry Twilio's numeric codes. Status
 * callbacks are form posts signed with `X-Twilio-Signature`.
 */
export interface TwilioMessage {
  sid: string;
  to: string;
  from: string | null;
  messagingServiceSid: string | null;
  body: string | null;
  contentSid: string | null;
  contentVariables: Record<string, string> | null;
  statusCallback: string | null;
  status: string;
}

export interface TwilioFake {
  url: string;
  accountSid: string;
  authToken: string;
  messages: TwilioMessage[];
  /** Numbers that replied STOP. */
  stopped: Set<string>;
  /** The next `n` calls answer 429. */
  rateLimit(n: number): void;
  /** Posts a signed status callback for a message, as Twilio would. */
  report(sid: string, status: 'sent' | 'delivered' | 'undelivered' | 'failed' | 'read', errorCode?: number): Promise<Response>;
  close(): Promise<void>;
}

/** Twilio's request signature: HMAC-SHA1 over the URL and the sorted form parameters, base64. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

const err = (status: number, code: number, message: string): Reply => ({ status, body: { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status } });

export async function startTwilioFake(opts: { accountSid?: string; authToken?: string } = {}): Promise<TwilioFake> {
  const accountSid = opts.accountSid ?? `AC${randomBytes(16).toString('hex')}`;
  const authToken = opts.authToken ?? randomBytes(16).toString('hex');
  const messages: TwilioMessage[] = [];
  const stopped = new Set<string>();
  let limited = 0;

  const handle = (req: Req): Reply => {
    const auth = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
    if (auth !== `${accountSid}:${authToken}`) return err(401, 20003, 'Authenticate');
    if (limited > 0) {
      limited--;
      return err(429, 20429, 'Too Many Requests');
    }
    if (req.method !== 'POST' || req.path !== `/2010-04-01/Accounts/${accountSid}/Messages.json`) return err(404, 20404, 'The requested resource was not found');
    if (!String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) return err(400, 21608, 'Request body must be form encoded');
    const p = new URLSearchParams(req.raw);
    const to = p.get('To') ?? '';
    const from = p.get('From');
    const service = p.get('MessagingServiceSid');
    const wa = to.startsWith('whatsapp:');
    if (!E164.test(to.replace(/^whatsapp:/, ''))) return err(400, 21211, `The 'To' number ${to} is not a valid phone number.`);
    if (!from && !service) return err(400, 21603, "A 'From' or 'MessagingServiceSid' parameter is required.");
    if (wa && !(from ?? '').startsWith('whatsapp:')) return err(400, 63007, 'Twilio could not find a Channel with the specified From address');
    if (stopped.has(to.replace(/^whatsapp:/, ''))) return err(400, 21610, 'Attempt to send to unsubscribed recipient');
    const body = p.get('Body');
    const contentSid = p.get('ContentSid');
    if (!body && !contentSid) return err(400, 21602, 'Message body is required.');
    if (body && body.length > 1600) return err(400, 21617, 'The concatenated message body exceeds the 1600 character limit.');
    let vars: Record<string, string> | null = null;
    if (p.get('ContentVariables')) {
      try {
        vars = JSON.parse(p.get('ContentVariables')!);
      } catch {
        return err(400, 21656, 'The ContentVariables Parameter is invalid.');
      }
    }
    const m: TwilioMessage = {
      sid: `SM${randomBytes(16).toString('hex')}`, to, from, messagingServiceSid: service, body, contentSid, contentVariables: vars, statusCallback: p.get('StatusCallback'), status: 'queued',
    };
    messages.push(m);
    return { status: 201, body: { sid: m.sid, account_sid: accountSid, to, from, body, status: 'queued', num_segments: String(Math.ceil((body ?? '').length / 153) || 1), error_code: null } };
  };

  const srv = await serve(handle);
  return {
    url: srv.url, accountSid, authToken, messages, stopped, close: srv.close,
    rateLimit: (n) => void (limited = n),
    async report(sid, status, errorCode) {
      const m = messages.find((x) => x.sid === sid);
      if (!m?.statusCallback) throw new Error(`no status callback for ${sid}`);
      m.status = status;
      const params: Record<string, string> = { AccountSid: accountSid, MessageSid: sid, SmsSid: sid, MessageStatus: status, SmsStatus: status, To: m.to, From: m.from ?? '', ApiVersion: '2010-04-01' };
      if (errorCode) params.ErrorCode = String(errorCode);
      return fetch(m.statusCallback, {
        method: 'POST', body: new URLSearchParams(params).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature(authToken, m.statusCallback, params) },
      });
    },
  };
}
