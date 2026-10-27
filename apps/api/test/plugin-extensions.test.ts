import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { definePlugin, HookVeto } from '@openrent/plugin-sdk';
// @ts-expect-error plain JS bin without types
import { scaffold } from '../../../packages/create-openrent-plugin/bin/create.mjs';
import { packPlugin } from '../../../packages/cli/src/plugin-kit.ts';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('plugin extensions: admin slots, storefront fields and badges, install', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  let variant: string;
  let work: string;
  const sf = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url: `/api/v1/storefront${url}`, payload: payload as any }).then((r) => ({ status: r.statusCode, body: r.json() }));

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    work = await mkdtemp(path.join(tmpdir(), 'orplugins-'));
    await mkdir(path.join(work, 'gates', 'admin'), { recursive: true });
    await writeFile(path.join(work, 'gates', 'admin', 'panel.js'), "customElements.define('gates-order-sidebar', class extends HTMLElement {});");
    await writeFile(path.join(work, 'gates', 'secret.txt'), 'not for browsers');
    t.deps.plugins.dirs.set('gates', path.join(work, 'gates'));
    await t.deps.plugins.register(
      definePlugin({
        id: 'gates',
        name: 'Gate codes',
        version: '1.0.0',
        compat: '^1.1.0',
        admin: [{ slot: 'order.sidebar', file: 'admin/panel.js' }],
        setup(api) {
          api.adminSlot('dashboard.widget', 'https://cdn.example/gates.js', 'gates-dashboard');
          api.storefront({
            checkoutFields: [
              { key: 'gate_code', type: 'text', required: true, label: { en: 'Gate code', de: 'Torcode' } },
              { key: 'trailer', type: 'select', label: { en: 'Trailer' }, options: [{ value: 'small', label: { en: 'Small' } }] },
            ],
            productBadges: [{ tag: 'eco', label: { en: 'Eco friendly', de: 'Umweltfreundlich' }, tone: 'success' }],
            scripts: [{ src: 'https://stats.example/s.js', consent: 'analytics' }, { src: 'javascript:alert(1)', consent: 'necessary' }],
          });
          api.before('checkout.complete', (p: any) => {
            if (p.extra['gates.gate_code'] === '0000') throw new HookVeto('gate_code_rejected', 'This gate code is not accepted');
          });
        },
      }),
    );
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Trailer', tracking: 'bulk', tags: ['eco'], price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
    variant = p.body.variants[0].id;
    await admin.put(`/api/v1/stock_levels/${variant}/${locationId}`, { quantity: 5 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('lists admin extensions and serves only declared bundle files', async () => {
    const slots = (await admin.get('/api/v1/plugin_slots')).body.data;
    expect(slots).toEqual(
      expect.arrayContaining([
        { object: 'plugin_slot', plugin_id: 'gates', slot: 'order.sidebar', url: '/api/v1/plugins/gates/ui/admin/panel.js', element: 'gates-order-sidebar' },
        { object: 'plugin_slot', plugin_id: 'gates', slot: 'dashboard.widget', url: 'https://cdn.example/gates.js', element: 'gates-dashboard' },
      ]),
    );
    const js = await admin.get('/api/v1/plugins/gates/ui/admin/panel.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
    expect((await admin.get('/api/v1/plugins/gates/ui/secret.txt')).status).toBe(404);
    expect((await admin.get('/api/v1/plugins/gates/ui/../gates/secret.txt')).status).toBe(404);
  });

  it('adds checkout fields, badges and consent scripts to the storefront', async () => {
    const settings = (await t.app.inject({ method: 'GET', url: '/api/v1/storefront/settings?locale=de' })).json();
    expect(settings.extensions.checkout_fields).toEqual([
      { key: 'gates.gate_code', type: 'text', required: true, label: 'Torcode', help: null, options: [] },
      { key: 'gates.trailer', type: 'select', required: false, label: 'Trailer', help: null, options: [{ value: 'small', label: 'Small' }] },
    ]);
    expect(settings.extensions.scripts).toEqual([{ plugin: 'gates', src: 'https://stats.example/s.js', consent: 'analytics', attrs: {}, connect: [] }]);
    expect(settings.csp.script).toContain('https://stats.example');
    const product = (await sf('GET', '/catalog/products?locale=de')).body.data.find((x: any) => x.name === 'Trailer');
    expect(product.badges).toEqual([{ label: 'Umweltfreundlich', tone: 'success' }]);

    const book = async (extra?: Record<string, unknown>) => {
      const s = await sf('POST', '/checkout_sessions', { starts_at: isoIn(3), ends_at: isoIn(4), lines: [{ variant_id: variant, quantity: 1 }] });
      return sf('POST', `/checkout_sessions/${s.body.id}/actions/complete`, { customer: { name: 'Gate Person', email: `g-${Math.random()}@test.dev` }, terms_accepted: true, terms_hash: settings.terms.hash, ...(extra ? { extra } : {}) });
    };
    const missing = await book();
    expect(missing.status).toBe(422);
    expect(missing.body.errors.map((e: any) => e.field)).toEqual(['extra.gates.gate_code']);
    expect((await book({ 'gates.gate_code': '1234', 'gates.trailer': 'huge' })).body.errors[0].field).toBe('extra.gates.trailer');
    const vetoed = await book({ 'gates.gate_code': '0000' });
    expect(vetoed.status).toBe(422);
    expect(vetoed.body.code).toBe('gate_code_rejected');
    const ok = await book({ 'gates.gate_code': '1234', 'gates.trailer': 'small' });
    expect(ok.status).toBe(200);
    const order = await admin.get(`/api/v1/orders/${ok.body.order.id}`);
    expect(order.body.custom_fields).toMatchObject({ plg_gates_gate_code: '1234', plg_gates_trailer: 'small' });

    // A shop that turns the plugin off has none of it.
    await admin.patch('/api/v1/plugins/gates', { enabled: false });
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/storefront/settings' })).json().extensions.checkout_fields).toEqual([]);
    expect((await admin.get('/api/v1/plugin_slots')).body.data.some((s: any) => s.plugin_id === 'gates')).toBe(false);
    await admin.patch('/api/v1/plugins/gates', { enabled: true });
  });

  it('installs a packed plugin after the owner confirms, when the server allows it', async () => {
    expect((await admin.post('/api/v1/plugins/install', { url: 'https://example.com/x.zip' })).status).toBe(403);
    const pluginsDir = path.join(work, 'installed');
    const pluginsJson = path.join(work, 'plugins.json');
    await writeFile(pluginsJson, JSON.stringify({ plugins: ['@openrent/plugin-notify-smtp'] }));
    Object.assign(t.deps.config, { allowPluginUpload: true, pluginsDir, pluginsConfig: pluginsJson });
    expect((await admin.get('/api/v1/plugins')).body.install_allowed).toBe(true);

    const src = path.join(work, 'src', 'deposit-reminders');
    await scaffold(src);
    const { file } = await packPlugin(src);
    expect((await admin.post('/api/v1/plugins/install', { url: 'http://insecure.example/p.zip' })).body.errors[0].field).toBe('url');
    const bad = await admin.upload('/api/v1/plugins/install', 'junk.zip', 'application/zip', Buffer.from('not a zip'));
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].field).toBe('file');

    const staged = await admin.upload('/api/v1/plugins/install', 'plugin.zip', 'application/zip', await readFile(file!));
    expect(staged.status).toBe(200);
    expect(staged.body).toMatchObject({ object: 'plugin_install', plugin: { id: 'deposit-reminders', version: '0.1.0', permissions: ['orders:read', 'db:own_tables', 'admin:ui'] }, warnings: [], replaces: null });
    expect(existsSync(path.join(pluginsDir, 'deposit-reminders'))).toBe(false);

    const done = await admin.post(`/api/v1/plugins/install/${staged.body.id}/actions/confirm`);
    expect(done.body).toMatchObject({ status: 'installed', restart_required: true });
    expect(existsSync(path.join(pluginsDir, 'deposit-reminders', 'openrent.plugin.json'))).toBe(true);
    expect(JSON.parse(await readFile(pluginsJson, 'utf8')).plugins).toEqual(['@openrent/plugin-notify-smtp', 'deposit-reminders']);
    expect((await admin.post(`/api/v1/plugins/install/${staged.body.id}/actions/confirm`)).status).toBe(404);
  });
});
