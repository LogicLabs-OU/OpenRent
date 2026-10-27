import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenancy, themes } from '@openrent/core';
import { withSystem } from '@openrent/db';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** The shop's own storefront pages with sections per theme, and its header and footer menus. */
suite('storefront pages and menus', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  const shop = (headers: Record<string, string> = {}) => new Client(t.app, { 'x-tenant-slug': 'test-rentals', ...headers });

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
    await admin.patch('/api/v1/tenant/settings', { storefront: { locales: ['en', 'de'], default_locale: 'en' } });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  let about: any;

  it('creates a draft page with an address from its title, cleaned text and texts in other languages', async () => {
    const r = await admin.post('/api/v1/storefront_pages', { title: 'About us', body: '<p>Since <strong>2011</strong>.</p><script>alert(1)</script>', seo: { title: 'About Lake Rentals', description: '' }, translations: { de: { title: 'Über uns', body: '<p>Seit 2011.</p>', seo_title: '' } } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    about = r.body;
    expect(about).toMatchObject({ object: 'storefront_page', slug: 'about-us', status: 'draft', title: 'About us', seo: { title: 'About Lake Rentals' }, translations: { de: { title: 'Über uns', body: '<p>Seit 2011.</p>' } } });
    expect(about.body).not.toContain('script');
    expect(about.translations.de.seo_title).toBeUndefined();
    const audit = await admin.get(`/api/v1/audit_log?filter[entity_id]=${about.id}`);
    expect(audit.body.data.map((a: any) => a.action)).toContain('create');
  });

  it('refuses a missing title, a bad, reserved or taken address, and long search texts, field by field', async () => {
    const cases: [unknown, string][] = [
      [{ title: '  ' }, 'title'],
      [{ title: 'X', slug: 'About Us' }, 'slug'],
      [{ title: 'Terms', slug: 'terms' }, 'slug'],
      [{ title: 'Again', slug: 'about-us' }, 'slug'],
      [{ title: 'X', seo: { title: 'x'.repeat(71) } }, 'seo.title'],
      [{ title: 'X', translations: { xx: { title: 'Y' } } }, 'translations.xx'],
    ];
    for (const [body, field] of cases) {
      const r = await admin.post('/api/v1/storefront_pages', body);
      expect([r.status, r.body.errors?.[0]?.field], JSON.stringify(body)).toEqual([422, field]);
    }
  });

  it('shows shoppers published pages only, drafts in a theme preview, in their language', async () => {
    expect((await shop().get('/api/v1/storefront/pages/about-us')).status).toBe(404);
    const token = themes.previewToken(t.deps.config.sessionSecret, tenantId, 'default', new Date(Date.now() + 600_000));
    const preview = await shop({ 'x-theme-preview': token }).get('/api/v1/storefront/pages/about-us');
    expect([preview.status, preview.headers['cache-control']]).toEqual([200, 'private, no-store']);
    expect(preview.body.status).toBe('draft');
    await admin.patch(`/api/v1/storefront_pages/${about.id}`, { status: 'published' });
    const en = await shop().get('/api/v1/storefront/pages/about-us');
    expect(en.status).toBe(200);
    expect(en.body).toMatchObject({ title: 'About us', body_html: '<p>Since <strong>2011</strong>.</p>', seo: { title: 'About Lake Rentals', description: null }, sections: [] });
    const de = await shop().get('/api/v1/storefront/pages/about-us?locale=de');
    expect(de.body).toMatchObject({ title: 'Über uns', body_html: '<p>Seit 2011.</p>', seo: { title: 'About Lake Rentals' } });
  });

  it('keeps sections per theme, checked against that theme, with their texts per language', async () => {
    const bad = await admin.put(`/api/v1/storefront_pages/${about.id}/sections/default`, { sections: [{ id: 'x', type: 'nope', settings: {} }] });
    expect(bad.status).toBe(422);
    const unknownTheme = await admin.put(`/api/v1/storefront_pages/${about.id}/sections/no-such-theme`, { sections: [] });
    expect(unknownTheme.status).toBe(404);
    const ok = await admin.put(`/api/v1/storefront_pages/${about.id}/sections/default`, { sections: [{ id: 'faq-1', type: 'faq', settings: { heading: 'Questions' }, blocks: [{ id: 'q1', type: 'item', settings: { question: 'Open on Sundays?', answer: 'No.' } }] }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.sections.default[0]).toMatchObject({ id: 'faq-1', type: 'faq' });
    const tr = await admin.put(`/api/v1/storefront_pages/${about.id}/content/default/de`, { values: { 'sections.faq-1.heading': 'Fragen', 'settings.footer': 'x' } });
    expect([tr.status, tr.body.errors?.[0]?.field]).toEqual([422, 'values.settings.footer']);
    expect((await admin.put(`/api/v1/storefront_pages/${about.id}/content/default/de`, { values: { 'sections.faq-1.heading': 'Fragen' } })).status).toBe(200);
    const de = await shop().get('/api/v1/storefront/pages/about-us?locale=de');
    expect(de.body.sections[0].id).toBe('faq-1');
    expect(de.body.content).toEqual({ 'sections.faq-1.heading': 'Fragen' });
    // Another theme has no sections for the page until the shop adds some.
    const token = themes.previewToken(t.deps.config.sessionSecret, tenantId, 'retro', new Date(Date.now() + 600_000));
    expect((await shop({ 'x-theme-preview': token }).get('/api/v1/storefront/pages/about-us')).body.sections).toEqual([]);
  });

  it('builds menus from categories, pages, products and addresses, leaving out what shoppers cannot open', async () => {
    const cat = await admin.post('/api/v1/categories', { name: 'Kayaks', translations: { de: { name: 'Kajaks' } } });
    const product = await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'bulk', price: { kind: 'fixed', amount: 100 } });
    const hidden = await admin.post('/api/v1/products', { type: 'rental', name: 'Secret', tracking: 'bulk', visibility: 'hidden', price: { kind: 'fixed', amount: 100 } });
    const draft = await admin.post('/api/v1/storefront_pages', { title: 'Coming soon' });
    const put = await admin.put('/api/v1/storefront_navigation', {
      header: [
        { kind: 'category', target: cat.body.id },
        { kind: 'page', target: about.id, label: 'Our story', translations: { de: 'Geschichte' } },
        { kind: 'product', target: product.body.id },
        { kind: 'product', target: hidden.body.id },
        { kind: 'page', target: draft.body.id },
      ],
      footer: [{ kind: 'url', target: 'https://instagram.example/lake', label: 'Instagram' }, { kind: 'url', target: '/c/kayaks', label: 'Kayaks' }, { kind: 'search', label: 'Search' }],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const en = (await shop().get('/api/v1/storefront/settings')).body.navigation;
    expect(en.header).toEqual([
      { label: 'Kayaks', href: '/c/kayaks', external: false },
      { label: 'Our story', href: '/pages/about-us', external: false },
      { label: 'Canoe', href: `/p/${product.body.slug}`, external: false },
    ]);
    expect(en.footer).toEqual([
      { label: 'Instagram', href: 'https://instagram.example/lake', external: true },
      { label: 'Kayaks', href: '/c/kayaks', external: false },
      { label: 'Search', href: '/search', external: false },
    ]);
    const de = (await shop().get('/api/v1/storefront/settings?locale=de')).body.navigation;
    expect(de.header.map((l: any) => l.label)).toEqual(['Kajaks', 'Geschichte', 'Canoe']);
  });

  it('refuses menu links that could leave for a script or another protocol, or lack what they need', async () => {
    const cases: [unknown, string][] = [
      [{ kind: 'url', target: 'javascript:alert(1)', label: 'X' }, 'navigation.header.0.target'],
      [{ kind: 'url', target: '//evil.example', label: 'X' }, 'navigation.header.0.target'],
      [{ kind: 'url', target: 'https://ok.example' }, 'navigation.header.0.label'],
      [{ kind: 'category', target: 'nope' }, 'navigation.header.0.target'],
      [{ kind: 'home', label: 'x'.repeat(61) }, 'navigation.header.0.label'],
    ];
    for (const [item, field] of cases) {
      const r = await admin.put('/api/v1/storefront_navigation', { header: [item], footer: [] });
      expect([r.status, r.body.errors?.[0]?.field], JSON.stringify(item)).toEqual([422, field]);
    }
    const tooMany = await admin.put('/api/v1/storefront_navigation', { header: Array.from({ length: 13 }, () => ({ kind: 'home', label: 'Home' })), footer: [] });
    expect([tooMany.status, tooMany.body.errors[0].field]).toEqual([422, 'navigation.header']);
  });

  it('lists published pages in the sitemap and keeps pages to their own shop', async () => {
    const paths = (await shop().get('/api/v1/storefront/sitemap')).body.data.map((e: any) => e.path);
    expect(paths).toContain('/pages/about-us');
    expect(paths).not.toContain('/pages/coming-soon');
    await withSystem(t.deps.db, (c) => tenancy.runSetup(c, { owner: { email: 'other@test.dev', password: 'password123', name: 'Other' }, tenant: { name: 'Other Shop', slug: 'other', currency: 'EUR', timezone: 'UTC' }, location: { name: 'X' } }, { livemode: false }));
    const other = new Client(t.app);
    expect((await other.post('/api/v1/auth/login', { email: 'other@test.dev', password: 'password123' })).status).toBe(200);
    expect((await other.get('/api/v1/storefront_pages')).body.data.map((p: any) => p.slug)).toEqual(['contact', 'locations']);
    expect((await other.get(`/api/v1/storefront_pages/${about.id}`)).status).toBe(404);
    expect((await other.patch(`/api/v1/storefront_pages/${about.id}`, { title: 'Mine' })).status).toBe(404);
    expect((await new Client(t.app, { 'x-tenant-slug': 'other' }).get('/api/v1/storefront/pages/about-us')).status).toBe(404);
  });

  it('starts a new shop with draft Locations and Contact pages built from the storefront’s own sections', async () => {
    const own = (await admin.get('/api/v1/storefront_pages')).body.data;
    const contact = own.find((p: any) => p.slug === 'contact');
    expect(contact).toMatchObject({ status: 'draft', title: 'Contact', sections: { default: [{ type: 'plugin:openrent:contact' }] } });
    expect(own.find((p: any) => p.slug === 'locations').sections.default[0].type).toBe('plugin:openrent:locations');
    // Both types are offered to every theme that takes plugin sections, named in the shop's language.
    const theme = (await admin.get('/api/v1/themes/retro')).body;
    expect(theme.section_schemas.map((s: any) => s.type)).toEqual(expect.arrayContaining(['plugin:openrent:locations', 'plugin:openrent:contact']));
    const ok = await admin.put(`/api/v1/storefront_pages/${contact.id}/sections/retro`, { sections: [{ id: 'c', type: 'plugin:openrent:contact', settings: { heading: 'Schreib uns', consent: 'I agree' } }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('shows locations with their contact details and the days they are closed', async () => {
    const loc = (await admin.get('/api/v1/locations')).body.data[0];
    await admin.patch(`/api/v1/locations/${loc.id}`, { phone: '+372 555 0101', email: 'shop@test.dev', address: { line1: 'Kai 1', city: 'Tallinn' } });
    const day = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const b = await admin.post(`/api/v1/locations/${loc.id}/blackouts`, { starts_at: `${day}T00:00:00Z`, ends_at: `${day}T23:59:59Z`, reason: 'Stocktaking' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const s = (await shop().get('/api/v1/storefront/settings')).body.locations[0];
    expect(s).toMatchObject({ phone: '+372 555 0101', email: 'shop@test.dev', address: { line1: 'Kai 1', city: 'Tallinn' } });
    expect(s.closures).toEqual([expect.objectContaining({ reason: 'Stocktaking', starts_at: `${day}T00:00:00.000Z` })]);
  });

  it('passes contact messages to staff once, checks the fields, and drops what bots send', async () => {
    const bad = await shop().post('/api/v1/storefront/contact', { name: '', email: 'nope', message: ' ', consent_required: true });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: any) => e.field).sort()).toEqual(['consent', 'email', 'message', 'name']);
    const msg = { name: 'Kai', email: 'kai@test.dev', message: 'Do you rent canoes in winter?\nThanks', consent: 'I agree', consent_required: true };
    expect((await shop().post('/api/v1/storefront/contact', msg)).body).toEqual({ object: 'contact_message', sent: true });
    expect((await shop().post('/api/v1/storefront/contact', msg)).status).toBe(200);
    const bot = await shop().post('/api/v1/storefront/contact', { name: 'Bot', email: 'bot@spam.example', message: 'Buy now', website: 'https://spam.example' });
    expect(bot.body.sent).toBe(true);
    const notices = (await admin.get('/api/v1/me/notifications')).body.data.filter((n: any) => n.kind === 'staff_contact_message');
    expect(notices).toHaveLength(1);
    expect(notices[0].params).toMatchObject({ name: 'Kai', email: 'kai@test.dev', excerpt: 'Do you rent canoes in winter? Thanks' });
    const mails = (await admin.get('/api/v1/notifications')).body.data.filter((n: any) => n.template === 'staff_contact_message');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('Message from Kai');
    // A third message from the same sender within ten minutes goes through; a fourth waits.
    expect((await shop().post('/api/v1/storefront/contact', { ...msg, message: 'One more thing' })).status).toBe(200);
    expect((await shop().post('/api/v1/storefront/contact', { ...msg, message: 'And another' })).status).toBe(429);
    expect((await shop().post('/api/v1/storefront/contact', { ...msg, email: 'other@test.dev', message: 'Hello' })).status).toBe(200);
  });

  it('deletes a page, which drops it from menus', async () => {
    expect((await admin.del(`/api/v1/storefront_pages/${about.id}`)).status).toBe(204);
    expect((await shop().get('/api/v1/storefront/pages/about-us')).status).toBe(404);
    const nav = (await shop().get('/api/v1/storefront/settings')).body.navigation;
    expect(nav.header.map((l: any) => l.href)).not.toContain('/pages/about-us');
  });
});
