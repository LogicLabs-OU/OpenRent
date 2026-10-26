import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';
import { startOidcMock } from './oidc-mock.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Single sign-on with OpenID Connect against a local mock provider (FR-USR-4). */
suite('single sign-on', () => {
  let t: TestApp;
  let admin: Client;
  let idp: Awaited<ReturnType<typeof startOidcMock>>;
  let providerId: string;

  /** Start → provider → callback, like a browser following the redirects. */
  async function signInWithSso(next = '/orders') {
    const c = new Client(t.app);
    const start = await c.get(`/api/v1/auth/oidc/${providerId}/start?next=${encodeURIComponent(next)}`);
    expect(start.status).toBe(302);
    const authorize = String(start.headers.location);
    expect(authorize.startsWith(`${idp.issuer}/authorize?`)).toBe(true);
    const toCallback = await fetch(authorize, { redirect: 'manual' });
    const callback = new URL(toCallback.headers.get('location')!);
    const done = await c.get(`${callback.pathname}${callback.search}`);
    return { c, status: done.status, location: String(done.headers.location) };
  }

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    idp = await startOidcMock({ clientId: 'openrent-admin', clientSecret: 'shh' });
  }, 120_000);

  afterAll(async () => {
    await idp?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('sets a provider up field by field and shows the redirect URI to register', async () => {
    const bad = await admin.post('/api/v1/sso_providers', { name: '', issuer: 'ftp://idp', client_id: '', allowed_domains: ['not a domain'], default_role: 'owner' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field).sort()).toEqual(['allowed_domains[0]', 'client_id', 'default_role', 'issuer', 'name']);
    const r = await admin.post('/api/v1/sso_providers', { name: 'Example Inc', issuer: idp.issuer, client_id: 'openrent-admin', client_secret: 'shh', allowed_domains: ['Example.org'], default_role: 'staff' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    providerId = r.body.id;
    expect(r.body).toMatchObject({ has_client_secret: true, allowed_domains: ['example.org'], redirect_uri: `http://localhost:7070/api/v1/auth/oidc/${providerId}/callback` });
    expect(JSON.stringify(r.body)).not.toContain('shh');
    expect((await new Client(t.app).get('/api/v1/auth/sso?email=someone@example.org')).body.data.map((p: any) => p.name)).toEqual(['Example Inc']);
    expect((await new Client(t.app).get('/api/v1/auth/sso?email=someone@other.org')).body.data).toEqual([]);
  });

  it('signs a new person in, joining the shop with the default role', async () => {
    const { c, status, location } = await signInWithSso('/orders');
    expect([status, location]).toEqual([302, 'http://localhost:7070/admin/orders']);
    const me = (await c.get('/api/v1/auth/me')).body;
    expect([me.user.email, me.user.name, me.role, me.tenant.name]).toEqual(['ada@example.org', 'Ada Lovelace', 'staff', 'Test Rentals']);
    expect((await c.get('/api/v1/orders')).status).toBe(200);
    // The second time the same member signs in; nothing is added.
    await signInWithSso();
    expect((await admin.get('/api/v1/users')).body.data.filter((u: any) => u.email === 'ada@example.org')).toHaveLength(1);
  });

  it('refuses unverified emails, other domains, a tampered state and members whose access is off', async () => {
    idp.state.user = { sub: 'u2', email: 'eve@example.org', email_verified: false };
    expect((await signInWithSso()).location).toBe('http://localhost:7070/admin/login?sso_error=sso_email_unverified');
    idp.state.user = { sub: 'u3', email: 'eve@other.org', email_verified: true };
    expect((await signInWithSso()).location).toBe('http://localhost:7070/admin/login?sso_error=sso_domain_not_allowed');

    idp.state.user = { sub: 'u1', email: 'ada@example.org', email_verified: true, name: 'Ada Lovelace' };
    const c = new Client(t.app);
    await c.get(`/api/v1/auth/oidc/${providerId}/start`);
    const forged = await c.get(`/api/v1/auth/oidc/${providerId}/callback?code=x&state=wrong`);
    expect(String(forged.headers.location)).toContain('sso_error=');
    expect(c.cookies.get('or_session')).toBeUndefined();

    const ada = (await admin.get('/api/v1/users')).body.data.find((u: any) => u.email === 'ada@example.org');
    await admin.post(`/api/v1/users/${ada.id}/actions/disable`, {});
    expect((await signInWithSso()).location).toBe('http://localhost:7070/admin/login?sso_error=sso_user_disabled');
    await admin.post(`/api/v1/users/${ada.id}/actions/enable`, {});
  });

  it('can make single sign-on the only way in for the domain', async () => {
    await admin.post('/api/v1/users', { email: 'bob@example.org', name: 'Bob', role: 'staff', password: 'password123' });
    expect((await new Client(t.app).post('/api/v1/auth/login', { email: 'bob@example.org', password: 'password123' })).status).toBe(200);
    await admin.patch(`/api/v1/sso_providers/${providerId}`, { enforce_sso: true });
    const refused = await new Client(t.app).post('/api/v1/auth/login', { email: 'bob@example.org', password: 'password123' });
    expect([refused.status, refused.body.code]).toEqual([403, 'sso_required']);
    // The owner, on another domain, still signs in with a password.
    expect((await new Client(t.app).post('/api/v1/auth/login', { email: 'owner@test.dev', password: 'password123' })).status).toBe(200);
    await admin.patch(`/api/v1/sso_providers/${providerId}`, { enforce_sso: false });
  });
});
