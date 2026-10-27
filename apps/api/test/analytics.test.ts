import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Consent-aware analytics scripts (FR-SF-8): filled from the plugin's settings, with their CSP origins. */
suite('analytics scripts', () => {
  let t: TestApp;
  let admin: Client;
  const settings = async () => (await new Client(t.app, { 'x-tenant-slug': 'test-rentals' }).get('/api/v1/storefront/settings')).body;

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('loads nothing until an id is set', async () => {
    expect((await settings()).extensions.scripts).toEqual([]);
  });

  it('fills the ids into the scripts and allows their origins', async () => {
    await admin.patch('/api/v1/plugins/analytics', { enabled: true, config: { ga4_id: 'G-ABC123', plausible_domain: 'rent.example.com' } });
    const s = await settings();
    expect(s.extensions.scripts).toEqual([
      { plugin: 'analytics', src: 'https://www.googletagmanager.com/gtag/js?id=G-ABC123', consent: 'analytics', attrs: { 'data-ga4': 'G-ABC123' }, connect: ['https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://www.googletagmanager.com'] },
      { plugin: 'analytics', src: 'https://plausible.io/js/script.js', consent: 'analytics', attrs: { 'data-domain': 'rent.example.com' }, connect: ['https://plausible.io'] },
    ]);
    expect(s.csp.script).toEqual(expect.arrayContaining(['https://www.googletagmanager.com', 'https://plausible.io']));
    expect(s.csp.connect).toEqual(expect.arrayContaining(['https://region1.google-analytics.com', 'https://plausible.io']));
  });

  it('drops a value that would break out of its attribute or URL', async () => {
    await admin.patch('/api/v1/plugins/analytics', { config: { ga4_id: 'G-1" onload="x', plausible_host: 'javascript:alert(1)' } });
    const s = await settings();
    expect(s.extensions.scripts.map((x: any) => [x.src, x.attrs])).toEqual([['https://www.googletagmanager.com/gtag/js?id=G-1%22%20onload%3D%22x', {}]]);
  });
});
