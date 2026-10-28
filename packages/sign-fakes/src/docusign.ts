import { createHmac, createVerify, randomUUID } from 'node:crypto';
import { isPdf, serve, type Reply, type Server } from './server.ts';

/**
 * A stand-in for DocuSign: the JWT grant (an RS256 assertion signed with the integration's private key),
 * the user info that names the account and its base URI, and eSignature REST v2.1 envelopes. Connect
 * webhooks are made by the test with `webhook`, signed with HMAC-SHA256 like DocuSign's.
 */
export interface DocuSignEnvelope {
  envelopeId: string;
  status: 'sent' | 'delivered' | 'completed' | 'declined' | 'voided';
  pdf: Buffer;
  signers: { email: string; name: string; recipientId: string; tabs: any }[];
  emailSubject: string;
}

export interface DocuSignFake extends Server {
  accountId: string;
  envelopes: Map<string, DocuSignEnvelope>;
  complete(id: string): void;
  decline(id: string): void;
  /** A Connect message for the envelope and its X-DocuSign-Signature-1 header. */
  webhook(id: string, hmacKey: string): { body: string; signature: string };
}

const fail = (status: number, errorCode: string, message: string): Reply => ({ status, body: { errorCode, message } });

function verifyJwt(jwt: string, publicKeyPem: string) {
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256') return null;
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKeyPem, Buffer.from(s, 'base64url'));
  return ok ? JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) : null;
}

export async function startDocuSignFake(opts: { integrationKey: string; userId: string; publicKeyPem: string }): Promise<DocuSignFake> {
  const accountId = randomUUID();
  const tokens = new Set<string>();
  const envelopes = new Map<string, DocuSignEnvelope>();
  let base = '';
  const server = await serve((req) => {
    if (req.method === 'POST' && req.path === '/oauth/token') {
      // The OAuth endpoints answer errors as OAuth does: { error, error_description }.
      if (req.body?.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return { status: 400, body: { error: 'unsupported_grant_type' } };
      const claims = verifyJwt(String(req.body.assertion ?? ''), opts.publicKeyPem);
      const now = Math.floor(Date.now() / 1000);
      if (!claims || claims.iss !== opts.integrationKey || claims.sub !== opts.userId || claims.aud !== new URL(base).host || !(claims.exp > now) || !String(claims.scope ?? '').split(' ').includes('signature'))
        return { status: 400, body: { error: 'invalid_grant', error_description: 'the assertion is not valid' } };
      const token = `ds-${randomUUID()}`;
      tokens.add(token);
      return { status: 200, body: { access_token: token, token_type: 'Bearer', expires_in: 3600 } };
    }
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!tokens.has(bearer)) return fail(401, 'AUTHORIZATION_INVALID_TOKEN', 'The access token provided is expired, revoked or malformed.');
    if (req.method === 'GET' && req.path === '/oauth/userinfo') return { status: 200, body: { sub: opts.userId, accounts: [{ account_id: accountId, is_default: true, account_name: 'Fake account', base_uri: base }] } };
    const m = /^\/restapi\/v2\.1\/accounts\/([^/]+)\/envelopes(?:\/([^/]+))?(\/documents\/combined)?$/.exec(req.path);
    if (!m) return fail(404, 'NOT_FOUND', 'not found');
    if (m[1] !== accountId) return fail(400, 'ACCOUNT_LACKS_PERMISSIONS', 'wrong account');
    if (req.method === 'POST' && !m[2]) {
      const b = req.body ?? {};
      const doc = b.documents?.[0];
      if (!doc?.documentBase64 || !isPdf(Buffer.from(doc.documentBase64, 'base64')) || !doc.documentId || !doc.name) return fail(400, 'INVALID_REQUEST_BODY', 'a PDF document with documentId and name is required');
      const signers = b.recipients?.signers ?? [];
      if (!signers.length || signers.some((x: any) => !x.email || !x.name || !x.recipientId)) return fail(400, 'INVALID_RECIPIENT', 'signers need email, name and recipientId');
      if (signers.some((x: any) => !x.tabs?.signHereTabs?.length)) return fail(400, 'NO_SIGN_HERE_TABS', 'each signer needs a signHere tab');
      if (b.status !== 'sent') return fail(400, 'INVALID_REQUEST_BODY', 'status must be sent');
      const envelopeId = randomUUID();
      envelopes.set(envelopeId, { envelopeId, status: 'sent', pdf: Buffer.from(doc.documentBase64, 'base64'), signers, emailSubject: String(b.emailSubject ?? '') });
      return { status: 201, body: { envelopeId, status: 'sent', statusDateTime: new Date().toISOString(), uri: `/envelopes/${envelopeId}` } };
    }
    const e = m[2] ? envelopes.get(m[2]) : undefined;
    if (!e) return fail(404, 'ENVELOPE_DOES_NOT_EXIST', 'envelope not found');
    if (req.method === 'GET' && m[3]) return { status: 200, raw: { type: 'application/pdf', data: Buffer.concat([e.pdf, Buffer.from(`\n%${e.status} by docusign fake\n`)]) } };
    if (req.method === 'GET') return { status: 200, body: { envelopeId: e.envelopeId, status: e.status, emailSubject: e.emailSubject } };
    return fail(405, 'METHOD_NOT_ALLOWED', 'method');
  });
  base = server.url;
  const set = (id: string, status: DocuSignEnvelope['status']) => {
    const e = envelopes.get(id);
    if (!e || !['sent', 'delivered'].includes(e.status)) throw new Error(`envelope ${id} is not out for signing`);
    e.status = status;
  };
  return {
    ...server,
    accountId,
    envelopes,
    complete: (id) => set(id, 'completed'),
    decline: (id) => set(id, 'declined'),
    webhook: (id, hmacKey) => {
      const e = envelopes.get(id)!;
      const body = JSON.stringify({ event: `envelope-${e.status}`, apiVersion: 'v2.1', uri: `/restapi/v2.1/accounts/${accountId}/envelopes/${id}`, retryCount: 0, configurationId: 1, generatedDateTime: new Date().toISOString(), data: { accountId, userId: opts.userId, envelopeId: id } });
      return { body, signature: createHmac('sha256', hmacKey).update(body).digest('base64') };
    },
  };
}
