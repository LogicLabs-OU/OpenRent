import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import { files, sso, tenancy, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

// The installation's own search server and key, as an operator would set them.
process.env.MEILISEARCH_HOST = 'http://meilisearch:7700';
process.env.MEILISEARCH_API_KEY = 'operator-secret-key';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Fixes from the security review before 1.0 (docs/security/findings.md). */
suite('security review fixes', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: 'http://localhost:7070/admin', storefrontUrl: '', livemode: false }, logger: quietLogger }));
  const member = async (email: string, role: string) => {
    await admin.post('/api/v1/users', { email, name: email, role, password: 'member-pass-123' });
    const c = new Client(t.app);
    expect((await c.post('/api/v1/auth/login', { email, password: 'member-pass-123' })).status).toBe(200);
    return c;
  };

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
  }, 120_000);
  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('limits failed sign-ins per email, whatever headers come with them', async () => {
    await admin.post('/api/v1/users', { email: 'target@test.dev', name: 'Target', role: 'staff', password: 'right-password-1' });
    for (let i = 0; i < 10; i++) {
      const r = await new Client(t.app).post('/api/v1/auth/login', { email: 'target@test.dev', password: `wrong-${i}` }, { authorization: `x${i}`, 'x-forwarded-for': `203.0.113.${i}` });
      expect(r.status).toBe(401);
    }
    const locked = await new Client(t.app).post('/api/v1/auth/login', { email: 'target@test.dev', password: 'right-password-1' });
    expect([locked.status, locked.body.code]).toEqual([429, 'login_locked']);
  });

  it('takes each authenticator code once, also after a sign-in link', async () => {
    const secret = new Secret({ size: 20 });
    await admin.post('/api/v1/users', { email: 'twofa@test.dev', name: 'Two', role: 'staff', password: 'two-factor-pass' });
    await withSystem(t.deps.db, (c) => c.query(`UPDATE users SET totp_secret = $2 WHERE email = $1`, ['twofa@test.dev', secret.base32]));
    const code = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).generate();
    expect((await new Client(t.app).post('/api/v1/auth/login', { email: 'twofa@test.dev', password: 'two-factor-pass', totp: code })).status).toBe(200);
    const again = await new Client(t.app).post('/api/v1/auth/login', { email: 'twofa@test.dev', password: 'two-factor-pass', totp: code });
    expect(again.body.code).toBe('invalid_totp');

    const { auth } = await import('@openrent/core');
    const link = (await withSystem(t.deps.db, (c) => auth.createLoginToken(c, 'twofa@test.dev')))!;
    const noCode = await new Client(t.app).post('/api/v1/auth/magic_link/verify', { token: link.token });
    expect([noCode.status, noCode.body.code]).toEqual([401, 'totp_required']);
    // The link still works once the next code is given.
    const next = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).generate({ timestamp: Date.now() + 30_000 });
    expect((await new Client(t.app).post('/api/v1/auth/magic_link/verify', { token: link.token, totp: next })).status).toBe(200);
  });

  it('never trusts another shop’s identity provider for someone else’s staff', async () => {
    const other = await withSystem(t.deps.db, (c) => tenancy.runSetup(c, { owner: { email: 'evil@evil.test', password: 'evil-pass-123', name: 'Evil' }, tenant: { name: 'Evil Rentals', currency: 'EUR', timezone: 'UTC' }, location: { name: 'X' } } as any, { livemode: false }));
    await withSystem(t.deps.db, (c) => c.query(`INSERT INTO sso_providers (id, tenant_id, name, issuer, client_id, allowed_domains, default_role, enforce_sso, active) VALUES ('sso_evil', $1, 'Evil', 'https://idp.evil.test', 'x', '{test.dev}', 'staff', true, true)`, [other.tenantId]));
    const p = await withSystem(t.deps.db, (c) => sso.providerForLogin(c, 'sso_evil', (s) => s));
    const takeover = await withSystem(t.deps.db, (c) => sso.completeSsoLogin(c, p, { email: 'owner@test.dev', email_verified: true }, {})).catch((e) => e);
    expect(takeover.code).toBe('sso_other_shop');
    // The other shop's "SSO required" does not lock this shop's people out, nor is its button offered.
    expect((await new Client(t.app).post('/api/v1/auth/login', { email: 'owner@test.dev', password: 'password123' })).status).toBe(200);
    expect(await withSystem(t.deps.db, (c) => sso.providersForEmail(c, 'owner@test.dev'))).toEqual([]);
  });

  it('hides sign-in links from the message log', async () => {
    await new Client(t.app).post('/api/v1/auth/magic_link', { email: 'owner@test.dev' });
    const n = (await admin.get('/api/v1/notifications?limit=50')).body.data.find((x: any) => x.template === 'magic_link');
    expect(n).toMatchObject({ content_hidden: true, text: null });
    expect((await admin.get(`/api/v1/notifications/${n.id}`)).body.body_html).toBeNull();
  });

  it('gives API keys no more than their creator has, and keeps owners for owners', async () => {
    // A key that may only manage keys cannot mint one that may do everything.
    const keyMaker = (await admin.post('/api/v1/api_keys', { name: 'Key maker', kind: 'secret', scopes: ['api_keys:manage'] })).body.key;
    const viaKey = new Client(t.app, { authorization: `Bearer ${keyMaker}` });
    const wide = await viaKey.post('/api/v1/api_keys', { name: 'All', kind: 'secret', scopes: ['*'] });
    expect([wide.status, wide.body.errors?.[0]?.code]).toEqual([422, 'too_wide']);
    const unknown = await viaKey.post('/api/v1/api_keys', { name: 'Odd', kind: 'secret', scopes: ['god:mode'] });
    expect(unknown.body.errors?.[0]?.code).toBe('unknown');
    expect((await viaKey.post('/api/v1/api_keys', { name: 'Same', kind: 'secret' })).body.scopes).toEqual(['api_keys:manage']);
    const adminUser = await member('admin@test.dev', 'admin');
    const ok = await adminUser.post('/api/v1/api_keys', { name: 'Reports', kind: 'secret', scopes: ['reports:read'] });
    expect(ok.status).toBe(201);
    const users = (await admin.get('/api/v1/users')).body.data;
    const owner = users.find((u: any) => u.email === 'owner@test.dev');
    const reset = await adminUser.post(`/api/v1/users/${owner.id}/actions/reset_password`, {});
    expect([reset.status, reset.body.code]).toEqual([403, 'forbidden']);
  });

  it('serves uploads so they cannot run script, and refuses odd import files', async () => {
    const html = await admin.upload('/api/v1/files?purpose=import', 'x.html', 'text/html', Buffer.from('<script>alert(1)</script>'));
    expect(html.status).toBe(415);
    const csv = await admin.upload('/api/v1/files?purpose=import', 'x.csv', 'text/csv', Buffer.from('name\nKayak\n'));
    const got = await admin.get(`/api/v1/files/${csv.body.id}/content`);
    expect(got.headers['content-disposition']).toMatch(/^attachment/);
    expect(got.headers['content-security-policy']).toContain('sandbox');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    const sig = await inTenant((ctx) => files.putFile(ctx, { kind: 'signature', filename: 's.png', contentType: 'image/png', body: Buffer.from('x') }));
    expect((await admin.get(`/api/v1/files/${sig.id}/content`)).status).toBe(404);
    const svg = await inTenant((ctx) => files.putFile(ctx, { kind: 'theme_asset', filename: 'logo.svg', contentType: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') }));
    const asset = await new Client(t.app).get(`/api/v1/public/theme_assets/${svg.id}/logo.svg`);
    expect(asset.headers['content-security-policy']).toContain('sandbox');
    expect(asset.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('never sends the operator’s plugin keys to a host a shop chose (multi-shop)', async () => {
    const { plugins } = await import('@openrent/core');
    const configOf = () => withTenant(t.deps.db, tenantId, (c) => plugins.pluginConfig({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false, multiTenant: true }, logger: quietLogger }, 'search-meilisearch'));
    expect((await configOf()).config).toMatchObject({ host: 'http://meilisearch:7700', api_key: 'operator-secret-key' });
    expect((await admin.patch('/api/v1/plugins/search-meilisearch', { config: { host: 'https://collector.evil.test' } })).status).toBe(200);
    const after = (await configOf()).config;
    expect(after.host).toBe('https://collector.evil.test');
    expect(after.api_key).toBeUndefined();
  });

  it('keeps storefront code out of the general settings', async () => {
    const r = await admin.patch('/api/v1/tenant/settings', { storefront_code: { header_html: '<form action="https://evil.test">' } });
    expect([r.status, r.body.errors[0].field]).toEqual([422, 'storefront_code']);
  });
});
