import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A minimal OpenID Connect provider for tests: discovery, an authorize endpoint that signs in whoever
 * `user` is right away, a token endpoint that checks PKCE, and its keys. Tokens are RS256 JWTs.
 */
export async function startOidcMock(opts: { clientId: string; clientSecret?: string; port?: number }) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { challenge: string; nonce: string; user: Record<string, unknown> }>();
  const state = { user: { sub: 'u1', email: 'ada@example.org', email_verified: true, name: 'Ada Lovelace' } as Record<string, unknown>, issuer: '' };
  const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
  const sign = (claims: Record<string, unknown>) => {
    const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }));
    const body = b64(JSON.stringify(claims));
    const s = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
    return `${head}.${body}.${b64(s)}`;
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', state.issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return json(200, {
        issuer: state.issuer, authorization_endpoint: `${state.issuer}/authorize`, token_endpoint: `${state.issuer}/token`, jwks_uri: `${state.issuer}/jwks`,
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      });
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const code = randomUUID();
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', nonce: url.searchParams.get('nonce') ?? '', user: { ...state.user } });
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      const p = new URLSearchParams(raw);
      const c = codes.get(p.get('code') ?? '');
      codes.delete(p.get('code') ?? '');
      const verifier = p.get('code_verifier') ?? '';
      if (!c || createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant' });
      if (opts.clientSecret && p.get('client_secret') !== opts.clientSecret) return json(401, { error: 'invalid_client' });
      const now = Math.floor(Date.now() / 1000);
      return json(200, { access_token: randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: sign({ iss: state.issuer, aud: opts.clientId, iat: now, exp: now + 300, nonce: c.nonce, ...c.user }) });
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((ok) => server.listen(opts.port ?? 0, '127.0.0.1', ok));
  state.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { state, issuer: state.issuer, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}
