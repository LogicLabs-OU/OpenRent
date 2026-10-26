import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Shared parts of the accounting fakes: an HTTP server with an OAuth 2 authorization server in front
 * (authorization code with PKCE, rotating refresh tokens, expiring access tokens), control endpoints
 * for tests (`/__fake/...`) and simulated rate limits. Each fake adds the provider's own API on top.
 */
export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  raw: string;
  body: any;
}

export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface OAuthOptions {
  clientId: string;
  clientSecret: string;
  /** How the token endpoint expects the client credentials. */
  clientAuth: 'basic' | 'body';
  /** Word before the access token in the Authorization header. */
  tokenPrefix: string;
  /** Seconds an access token lives. */
  ttl?: number;
  /** Extra query values sent back to the redirect URI (QuickBooks: realmId). */
  callbackParams?: Record<string, string>;
  /** Paths of the provider's authorize and token endpoints (defaults: …/authorize or …/auth, …/token). */
  authorizePath?: string;
  tokenPath?: string;
}

export interface FakeServer {
  url: string;
  close(): Promise<void>;
  /** Calls the provider API saw (OAuth and control calls excluded), oldest first. */
  calls: { method: string; path: string; body: any }[];
  /** The next `n` API calls answer 429 with Retry-After: `seconds`. */
  rateLimit(n: number, seconds?: number): void;
  /** Every access token stops working (as if it expired); refresh tokens still work. */
  expireTokens(): void;
  /** Every refresh token stops working (as if the shop revoked access). */
  revoke(): void;
  /** Access tokens handed out so far (to check what a test sent). */
  issued: number;
  /** An access token without the OAuth dance, for tests that call a plugin directly. */
  grant(): string;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): FakeReply => ({ status, body, headers });

export async function startFake(oauth: OAuthOptions, api: (req: FakeRequest) => FakeReply | Promise<FakeReply>, control: (req: FakeRequest) => FakeReply | null = () => null): Promise<FakeServer> {
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const access = new Map<string, number>();
  const refresh = new Set<string>();
  let limited = 0;
  let retryAfter = 1;
  const calls: FakeServer['calls'] = [];

  const issue = () => {
    const a = `fa-${randomUUID()}`;
    const r = `fr-${randomUUID()}`;
    access.set(a, Date.now() + (oauth.ttl ?? 1800) * 1000);
    refresh.add(r);
    fake.issued++;
    return { access_token: a, refresh_token: r, token_type: 'Bearer', expires_in: oauth.ttl ?? 1800 };
  };

  const handle = async (req: FakeRequest): Promise<FakeReply> => {
    if (oauth.authorizePath ? req.path === oauth.authorizePath : req.path.endsWith('/authorize') || req.path.endsWith('/auth')) {
      // The user "approves" at once: straight back to the shop with a code.
      const code = randomUUID();
      codes.set(code, { challenge: String(req.query.get('code_challenge') ?? ''), redirect: String(req.query.get('redirect_uri')) });
      const back = new URL(String(req.query.get('redirect_uri')));
      back.searchParams.set('code', code);
      back.searchParams.set('state', String(req.query.get('state')));
      for (const [k, v] of Object.entries(oauth.callbackParams ?? {})) back.searchParams.set(k, v);
      return { status: 302, headers: { location: back.href } };
    }
    if (oauth.tokenPath ? req.path === oauth.tokenPath : req.path.endsWith('/token')) {
      const p = new URLSearchParams(req.raw);
      const basic = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      const ok = oauth.clientAuth === 'basic'
        ? basic === `${oauth.clientId}:${oauth.clientSecret}`
        : p.get('client_id') === oauth.clientId && p.get('client_secret') === oauth.clientSecret && !req.headers.authorization;
      if (!ok) return json(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const c = codes.get(String(p.get('code')));
        codes.delete(String(p.get('code')));
        const verifier = String(p.get('code_verifier') ?? '');
        if (!c || createHash('sha256').update(verifier).digest('base64url') !== c.challenge || c.redirect !== p.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
        return json(200, issue());
      }
      if (p.get('grant_type') === 'refresh_token') {
        // Refresh tokens rotate: the old one is gone as soon as it is used.
        if (!refresh.delete(String(p.get('refresh_token')))) return json(400, { error: 'invalid_grant' });
        return json(200, issue());
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (req.path.startsWith('/__fake/')) return control(req) ?? json(404, { error: 'no such control' });
    const auth = String(req.headers.authorization ?? '');
    const token = auth.startsWith(`${oauth.tokenPrefix} `) ? auth.slice(oauth.tokenPrefix.length + 1) : '';
    const until = access.get(token);
    if (!until || until < Date.now()) return json(401, { error: 'unauthorized', message: 'AuthenticationUnsuccessful' });
    if (limited > 0) {
      limited--;
      return json(429, { error: 'rate limited' }, { 'retry-after': String(retryAfter) });
    }
    calls.push({ method: req.method, path: `${req.path}${req.query.size ? `?${req.query}` : ''}`, body: req.body });
    return api(req);
  };

  const server: Server = createServer(async (r: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const chunk of r) raw += chunk;
    const u = new URL(r.url ?? '/', 'http://fake');
    let body: any = undefined;
    if (raw && String(r.headers['content-type'] ?? '').includes('json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'malformed json' }));
        return;
      }
    }
    const reply = await handle({ method: r.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: r.headers, raw, body }).catch((e: Error) => json(500, { error: e.message }));
    res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
    res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const fake: FakeServer = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((ok) => server.close(() => ok())),
    calls,
    rateLimit(n, seconds = 1) {
      limited = n;
      retryAfter = seconds;
    },
    expireTokens() {
      for (const k of access.keys()) access.set(k, 0);
    },
    revoke() {
      refresh.clear();
      for (const k of access.keys()) access.set(k, 0);
    },
    issued: 0,
    grant: () => issue().access_token,
  };
  return fake;
}

/** Major units with `dp` decimals, rounded half away from zero like the accounting systems do. */
export const round = (n: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
};

export const id = () => randomUUID();
export { json };
