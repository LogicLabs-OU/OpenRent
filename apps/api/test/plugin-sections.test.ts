import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '@openrent/plugin-sdk';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Plugins add home page sections to themes that take them (FR-THM-12, plugin API 1.7, theme API 1.8). */
suite('plugin sections', () => {
  let t: TestApp;
  let admin: Client;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    await t.deps.plugins.register(
      definePlugin({
        id: 'notice-board',
        name: 'Notice board',
        version: '1.0.0',
        compat: '^1.7.0',
        setup(api) {
          api.storefront({
            sections: [
              {
                type: 'notice',
                name: { en: 'Notice', de: 'Hinweis' },
                settings: [{ id: 'text', type: 'text', label: 'Text', default: 'Open daily' }, { id: 'loud', type: 'checkbox', label: 'Loud' }],
                render: (ctx, s) => `<p class="notice">${s.loud ? '<strong>' : ''}${String(s.text)}${s.loud ? '</strong>' : ''} (${ctx.locale})</p><script>alert(1)</script>`,
              },
              { type: 'broken', name: { en: 'Broken' }, render: () => { throw new Error('boom'); } },
              { type: 'slow', name: { en: 'Slow' }, render: () => new Promise((ok) => setTimeout(() => ok('<p>late</p>'), 5000)) },
            ],
          });
        },
      }),
    );
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('offers the plugin’s section types in the section editor of themes that take them', async () => {
    const theme = (await admin.get('/api/v1/themes/default')).body;
    const notice = theme.section_schemas.find((s: any) => s.type === 'plugin:notice-board:notice');
    expect(notice).toMatchObject({ name: 'Notice', settings: [{ id: 'text', type: 'text' }, { id: 'loud', type: 'checkbox' }] });
    const bad = await admin.put('/api/v1/themes/default/sections', { sections: [{ id: 'n1', type: 'plugin:notice-board:nope', settings: {} }] });
    expect([bad.status, bad.body.errors[0].field]).toEqual([422, 'sections.0.type']);
  });

  it('renders the sections, cleaned, and leaves out one that fails or is too slow', async () => {
    const layout = [
      { id: 'hero', type: 'hero', settings: {} },
      { id: 'n1', type: 'plugin:notice-board:notice', settings: { loud: true } },
      { id: 'b1', type: 'plugin:notice-board:broken', settings: {} },
      { id: 's1', type: 'plugin:notice-board:slow', settings: {} },
    ];
    const saved = await admin.put('/api/v1/themes/default/sections', { sections: layout });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const s = (await shop().get('/api/v1/storefront/settings?locale=en')).body;
    expect(s.theme.plugin_sections).toEqual({ n1: '<p class="notice"><strong>Open daily</strong> (en)</p>', b1: '', s1: '' });
    // The storefront's own sections come first, then the plugin's.
    expect(s.extensions.sections.map((x: any) => x.type)).toEqual(['plugin:openrent:locations', 'plugin:openrent:contact', 'plugin:notice-board:notice', 'plugin:notice-board:broken', 'plugin:notice-board:slow']);
  }, 20_000);

  it('drops the sections when the shop turns the plugin off', async () => {
    await admin.patch('/api/v1/plugins/notice-board', { enabled: false });
    const s = (await shop().get('/api/v1/storefront/settings')).body;
    expect(s.theme.plugin_sections).toEqual({});
    expect(s.extensions.sections.map((x: any) => x.type)).toEqual(['plugin:openrent:locations', 'plugin:openrent:contact']);
  });
});
