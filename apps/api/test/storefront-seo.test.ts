import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { domains, type Ctx } from '@openrent/core';
import { withTenant } from '@openrent/db';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Search engine texts for the home page, categories and products, and the shop's own address for canonical links. */
suite('storefront search engine data', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const inTenant = <T>(config: Partial<Ctx['config']>, fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) => fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: 'https://shops.example', livemode: false, ...config }, logger: quietLogger }));

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en', 'de'], default_locale: 'en' } });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  const settings = async (locale = 'en') => (await shop().get(`/api/v1/storefront/settings?locale=${locale}`)).body;

  it('has the shop name and logo until the shop writes its own texts and picture', async () => {
    await admin.patch('/api/v1/tenant', { branding: { logo_url: 'https://cdn.example/logo.png' } });
    const s = await settings();
    expect(s.seo).toEqual({ base_url: t.deps.config.storefrontUrl, title: null, description: null, image_url: 'https://cdn.example/logo.png' });
  });

  it('keeps the home page texts per language, falling back to the default, and clears them again', async () => {
    const r = await admin.patch('/api/v1/tenant/settings', { seo: { title: 'Camera rental in Tallinn', description: 'Cameras and lenses by the day.', image_url: 'https://cdn.example/share.jpg', translations: { de: { title: 'Kameraverleih in Tallinn' } } } });
    expect(r.status).toBe(200);
    expect((await settings()).seo).toMatchObject({ title: 'Camera rental in Tallinn', description: 'Cameras and lenses by the day.', image_url: 'https://cdn.example/share.jpg' });
    expect((await settings('de')).seo).toMatchObject({ title: 'Kameraverleih in Tallinn', description: 'Cameras and lenses by the day.' });
    await admin.patch('/api/v1/tenant/settings', { seo: { translations: { de: { title: null } } } });
    expect((await settings('de')).seo.title).toBe('Camera rental in Tallinn');
  });

  it('refuses texts longer than search results show, and pictures that are not https', async () => {
    const long = await admin.patch('/api/v1/tenant/settings', { seo: { title: 'x'.repeat(71) } });
    expect([long.status, long.body.errors.map((e: any) => e.field)]).toEqual([422, ['seo.title']]);
    const lang = await admin.patch('/api/v1/tenant/settings', { seo: { translations: { de: { description: 'x'.repeat(161) } } } });
    expect([lang.status, lang.body.errors[0].field]).toEqual([422, 'seo.translations.de.description']);
    for (const image_url of ['http://cdn.example/a.jpg', 'javascript:alert(1)', 'https://a b']) {
      const bad = await admin.patch('/api/v1/tenant/settings', { seo: { image_url } });
      expect([bad.status, bad.body.errors[0].field], image_url).toEqual([422, 'seo.image_url']);
    }
  });

  it('gives categories and products their texts in the page language', async () => {
    const cat = await admin.post('/api/v1/categories', { name: 'Lenses', seo: { title: 'Lenses for rent', description: 'Primes and zooms.' }, translations: { de: { name: 'Objektive', seo_title: 'Objektive mieten' } } });
    expect(cat.status).toBe(201);
    expect(cat.body.seo).toEqual({ title: 'Lenses for rent', description: 'Primes and zooms.' });
    const tooLong = await admin.post('/api/v1/categories', { name: 'Bad', seo: { title: 'x'.repeat(71) } });
    expect(tooLong.status).toBe(400);
    const de = (await settings('de')).categories.find((c: any) => c.id === cat.body.id);
    expect(de).toMatchObject({ name: 'Objektive', seo: { title: 'Objektive mieten', description: 'Primes and zooms.' } });

    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Camera', description: 'A long product description.', tracking: 'bulk', seo: { title: 'Camera hire', description: 'Rent the camera.' }, translations: { de: { name: 'Kamera', seo_description: 'Die Kamera mieten.' } }, price: { kind: 'per_period', period_unit: 'day', amount: 5000 } });
    const en = (await shop().get(`/api/v1/storefront/catalog/products/${p.body.slug}`)).body;
    expect(en.seo).toEqual({ title: 'Camera hire', description: 'Rent the camera.' });
    expect(en.updated_at).toBeTruthy();
    const deP = (await shop().get(`/api/v1/storefront/catalog/products/${p.body.slug}?locale=de`)).body;
    expect(deP.seo).toEqual({ title: 'Camera hire', description: 'Die Kamera mieten.' });
  });

  it('lists the home page, categories and public products for the sitemap, not hidden or deleted ones', async () => {
    const hidden = await admin.post('/api/v1/products', { type: 'rental', name: 'Secret', tracking: 'bulk', visibility: 'hidden', price: { kind: 'fixed', amount: 100 } });
    expect(hidden.status).toBe(201);
    const gone = await admin.post('/api/v1/products', { type: 'rental', name: 'Gone', tracking: 'bulk', price: { kind: 'fixed', amount: 100 } });
    await admin.del(`/api/v1/products/${gone.body.id}`);
    const r = await shop().get('/api/v1/storefront/sitemap');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toContain('public');
    expect(r.body).toMatchObject({ object: 'storefront_sitemap', default_locale: 'en', locales: ['en', 'de'] });
    const paths = r.body.data.map((e: any) => e.path);
    expect(paths[0]).toBe('/');
    expect(paths).toContain('/c/lenses');
    expect(paths).toContain('/p/camera');
    expect(paths).not.toContain(`/p/${hidden.body.slug}`);
    expect(paths).not.toContain(`/p/${gone.body.slug}`);
    expect(r.body.total).toBe(paths.length);
    expect(r.body.data.find((e: any) => e.path === '/p/camera').updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const page = await shop().get('/api/v1/storefront/sitemap?offset=1&limit=1');
    expect(page.body.data.map((e: any) => e.path)).toEqual([paths[1]]);
  });

  it('links to the shop’s own domain, else its subdomain on a multi-shop installation, else the installation', async () => {
    expect(await inTenant({}, (ctx) => domains.storefrontBase(ctx))).toBe('https://shops.example');
    expect(await inTenant({ multiTenant: true, storefrontDomain: '*.shops.example' }, (ctx) => domains.storefrontBase(ctx))).toBe('https://test-rentals.shops.example');
    expect(await inTenant({ multiTenant: false, storefrontDomain: '*.shops.example' }, (ctx) => domains.storefrontBase(ctx))).toBe('https://shops.example');
    await inTenant({}, async (ctx) => {
      await ctx.db.query(`INSERT INTO storefront_domains (id, tenant_id, hostname, status, is_primary, verification_token, verified_at) VALUES ('dom_seo', $1, 'rent.example.com', 'verified', true, 'tok', now())`, [tenantId]);
    });
    expect(await inTenant({ multiTenant: true, storefrontDomain: '*.shops.example' }, (ctx) => domains.storefrontBase(ctx))).toBe('https://rent.example.com');
    expect((await settings()).seo.base_url).toBe('https://rent.example.com');
  });
});
