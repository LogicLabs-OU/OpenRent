import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, shopForTests, startApp, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** PRD §5.2: OAuth 2.1 for third-party apps, with PKCE, rotating refresh tokens and revocation. */
suite('OAuth 2.1 apps', () => {
  let t: TestApp;
  let admin: Client;
  const REDIRECT = 'https://wp.example.test/wp-admin/admin.php?page=openrent';
  let clientId: string;

  const form = (url: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    t.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, payload: new URLSearchParams(body).toString() }).then((r) => ({ status: r.statusCode, body: r.json(), headers: r.headers }));
  const bearer = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }).then((r) => ({ status: r.statusCode, body: r.json() }));
  const authorize = async (scope: string, extra: Record<string, string> = {}) => {
    const p = pkce();
    const q = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 'xyz', code_challenge: p.challenge, code_challenge_method: 'S256', ...extra };
    const r = await admin.post('/api/v1/oauth/authorize/approve', q);
    const url = new URL(r.body.redirect_to);
    return { code: url.searchParams.get('code')!, state: url.searchParams.get('state'), verifier: p.verifier, url };
  };
  const exchange = (code: string, verifier: string, extra: Record<string, string> = {}) =>
    form('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: clientId, ...extra });

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!, { OPENRENT_OPERATOR_KEY: 'op-key-for-tests-123456' }));
  }, 120_000);
  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('describes itself and lets apps register as public clients', async () => {
    const meta = (await t.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).json();
    expect(meta).toMatchObject({ issuer: 'http://localhost:7070', token_endpoint: 'http://localhost:7070/oauth/token', code_challenge_methods_supported: ['S256'] });
    expect(meta.scopes_supported).toContain('orders:read');

    const bad = await t.app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'Evil', redirect_uris: ['http://evil.example/cb'] } });
    expect([bad.statusCode, bad.json().error]).toEqual([400, 'invalid_redirect_uri']);
    const secretAsked = await t.app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'X', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' } });
    expect(secretAsked.json().error).toBe('invalid_client_metadata');
    const ok = await t.app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'OpenRent for WordPress', redirect_uris: [REDIRECT], client_uri: 'https://wp.example.test' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ token_endpoint_auth_method: 'none' });
    expect(ok.json()).not.toHaveProperty('client_secret');
    clientId = ok.json().client_id;
  });

  it('needs PKCE with S256, a registered address and known scopes', async () => {
    const base = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'orders:read', state: 's1' };
    expect((await admin.post('/api/v1/oauth/authorize/check', { ...base, redirect_uri: 'https://evil.example/cb' })).body).toMatchObject({ ok: false, problem: expect.any(String) });
    expect((await admin.post('/api/v1/oauth/authorize/check', { ...base, client_id: 'oac_nope' })).body.ok).toBe(false);
    const noPkce = (await admin.post('/api/v1/oauth/authorize/check', base)).body;
    expect(new URL(noPkce.redirect_to).searchParams.get('error')).toBe('invalid_request');
    expect(new URL(noPkce.redirect_to).searchParams.get('state')).toBe('s1');
    const plain = (await admin.post('/api/v1/oauth/authorize/check', { ...base, code_challenge: pkce().challenge, code_challenge_method: 'plain' })).body;
    expect(new URL(plain.redirect_to).searchParams.get('error')).toBe('invalid_request');
    const scope = (await admin.post('/api/v1/oauth/authorize/check', { ...base, scope: 'orders:read galaxy:rule', code_challenge: pkce().challenge, code_challenge_method: 'S256' })).body;
    expect(new URL(scope.redirect_to).searchParams.get('error')).toBe('invalid_scope');
    const good = (await admin.post('/api/v1/oauth/authorize/check', { ...base, code_challenge: pkce().challenge, code_challenge_method: 'S256' })).body;
    expect(good).toMatchObject({ ok: true, app: { name: 'OpenRent for WordPress', redirect_host: 'wp.example.test' }, scopes: ['orders:read'] });
    // The app's request again, declined.
    const no = await admin.post('/api/v1/oauth/authorize/deny', { ...base, code_challenge: pkce().challenge, code_challenge_method: 'S256' });
    expect(new URL(no.body.redirect_to).searchParams.get('error')).toBe('access_denied');
  });

  it('turns a code into tokens once, with the right verifier, and the token is limited to its scopes', async () => {
    const a = await authorize('orders:read catalog:read');
    expect(a.state).toBe('xyz');
    expect((await exchange(a.code, pkce().verifier)).body.error).toBe('invalid_grant');
    // The failed try used the code up as well? No: only a successful exchange uses it.
    const b = await authorize('orders:read catalog:read');
    expect((await exchange(b.code, b.verifier, { redirect_uri: 'https://wp.example.test/other' })).body.error).toBe('invalid_grant');
    const c = await authorize('orders:read catalog:read');
    const tok = await exchange(c.code, c.verifier);
    expect(tok.status).toBe(200);
    expect(tok.headers['cache-control']).toBe('no-store');
    expect(tok.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'orders:read catalog:read' });
    expect(tok.body.access_token).toMatch(/^oat_/);
    expect(tok.body.refresh_token).toMatch(/^ort_/);
    expect((await bearer(tok.body.access_token, '/api/v1/orders')).status).toBe(200);
    expect((await bearer(tok.body.access_token, '/api/v1/customers')).status).toBe(403);
    expect((await bearer('oat_made_up', '/api/v1/orders')).status).toBe(401);
    // The same code again: refused, and what it gave is taken back.
    expect((await exchange(c.code, c.verifier)).body.error).toBe('invalid_grant');
    expect((await bearer(tok.body.access_token, '/api/v1/orders')).status).toBe(401);
  });

  it('rotates refresh tokens and ends the grant when an old one comes back', async () => {
    const a = await authorize('orders:read');
    const first = (await exchange(a.code, a.verifier)).body;
    const second = (await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId })).body;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await bearer(first.access_token, '/api/v1/orders')).status).toBe(401);
    expect((await bearer(second.access_token, '/api/v1/orders')).status).toBe(200);
    expect((await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: clientId, scope: 'orders:read customers:read' })).body.error).toBe('invalid_scope');
    // The first refresh token again: someone copied it. Everything stops.
    const reuse = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId });
    expect([reuse.status, reuse.body.error]).toEqual([400, 'invalid_grant']);
    expect((await bearer(second.access_token, '/api/v1/orders')).status).toBe(401);
    expect((await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: clientId })).body.error).toBe('invalid_grant');
  });

  it('revokes tokens, lists the shop’s apps and disconnects them', async () => {
    const a = await authorize('orders:read');
    const tok = (await exchange(a.code, a.verifier)).body;
    expect((await form('/oauth/revoke', { token: tok.access_token, client_id: clientId })).status).toBe(200);
    expect((await bearer(tok.access_token, '/api/v1/orders')).status).toBe(401);
    expect((await form('/oauth/revoke', { token: 'ort_unknown', client_id: clientId })).status).toBe(200);

    const b = await authorize('orders:read');
    const live = (await exchange(b.code, b.verifier)).body;
    const apps = (await admin.get('/api/v1/oauth_grants')).body.data;
    expect(apps).toEqual([expect.objectContaining({ app_name: 'OpenRent for WordPress', scopes: ['orders:read'], approved_by: 'Owner' })]);
    expect((await admin.del(`/api/v1/oauth_grants/${apps[0].id}`)).status).toBe(200);
    expect((await bearer(live.access_token, '/api/v1/orders')).status).toBe(401);
    expect((await admin.get('/api/v1/oauth_grants')).body.data).toEqual([]);
    const audit = (await admin.get('/api/v1/audit_log?filter[entity_type]=oauth_grant')).body.data.map((x: any) => x.action);
    expect(audit).toEqual(['revoke']);
  });

  it('lets only people who manage API keys approve, and confidential clients prove themselves', async () => {
    await admin.post('/api/v1/users', { email: 'oauth-staff@test.dev', name: 'Staff', role: 'staff', password: 'staff-pass-123' });
    const staff = new Client(t.app);
    await staff.post('/api/v1/auth/login', { email: 'oauth-staff@test.dev', password: 'staff-pass-123' });
    expect((await staff.post('/api/v1/oauth/authorize/approve', { client_id: clientId })).status).toBe(403);

    const noKey = await t.app.inject({ method: 'POST', url: '/api/v1/operator/oauth_clients', payload: { client_name: 'Shopify app', redirect_uris: ['https://shopify-app.example.test/auth/callback'] } });
    expect(noKey.statusCode).toBe(401);
    const made = (await t.app.inject({ method: 'POST', url: '/api/v1/operator/oauth_clients', headers: { 'x-operator-key': 'op-key-for-tests-123456' }, payload: { client_name: 'Shopify app', redirect_uris: ['https://shopify-app.example.test/auth/callback'] } })).json();
    expect(made.client_secret).toMatch(/^ocs_/);
    const p = pkce();
    const q = { response_type: 'code', client_id: made.client_id, redirect_uri: 'https://shopify-app.example.test/auth/callback', scope: 'catalog:read', code_challenge: p.challenge, code_challenge_method: 'S256' };
    const code = new URL((await admin.post('/api/v1/oauth/authorize/approve', q)).body.redirect_to).searchParams.get('code')!;
    const body = { grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: q.redirect_uri };
    const wrong = await form('/oauth/token', body, { authorization: `Basic ${Buffer.from(`${made.client_id}:wrong`).toString('base64')}` });
    expect([wrong.status, wrong.body.error]).toEqual([401, 'invalid_client']);
    const right = await form('/oauth/token', body, { authorization: `Basic ${Buffer.from(`${made.client_id}:${made.client_secret}`).toString('base64')}` });
    expect(right.status).toBe(200);
    expect((await bearer(right.body.access_token, '/api/v1/products')).status).toBe(200);
  });

  it('keeps each token to its own shop', async () => {
    const other = await startApp(dbinfo!.url, 1);
    try {
      const a = await authorize('orders:read');
      const tok = (await exchange(a.code, a.verifier)).body;
      // A shop header naming another shop changes nothing: the token says which shop.
      const r = await t.app.inject({ method: 'GET', url: '/api/v1/orders', headers: { authorization: `Bearer ${tok.access_token}`, 'x-tenant-id': 'ten_other' } });
      expect(r.statusCode).toBe(200);
    } finally {
      await other.close();
    }
  });
});
