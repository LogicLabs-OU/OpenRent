import { bootstrap, buildApp, loadConfig } from '@openrent/api';
import { hookContext, type Ctx } from '@openrent/core';
import { migrate, migratePlugins, withTenant } from '@openrent/db';
import { startPglite } from '@openrent/db/dev/pglite';
import type { PluginDefinition } from '@openrent/plugin-sdk';

/**
 * A throwaway shop for plugin tests (FR-PLG-9): an in-memory PostgreSQL (PGlite), the real API with the
 * plugins under test registered and migrated, and a signed-in owner. Nothing touches a real database.
 *
 *   const shop = await startTestShop({ plugins: [myPlugin] });
 *   const order = await shop.post('/api/v1/orders', { … });
 *   await shop.close();
 */
export interface TestShop {
  tenantId: string;
  locationId: string;
  request(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }>;
  get(url: string): Promise<{ status: number; body: any }>;
  post(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  patch(url: string, body: unknown): Promise<{ status: number; body: any }>;
  /** Runs a plugin's scheduled job for this shop now. */
  runSchedule(pluginId: string, name: string): Promise<void>;
  /** Runs `fn` with a core context of this shop (system actor), e.g. to read plugin tables. */
  inShop<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

export async function startTestShop(opts: { plugins: PluginDefinition[]; currency?: string; timezone?: string }): Promise<TestShop> {
  const port = 6100 + Math.floor(Math.random() * 800);
  const pg = await startPglite({ port, maxConnections: 3 });
  await migrate(pg.url, { log: () => undefined });
  const config = loadConfig({
    DATABASE_URL: pg.url,
    OPENRENT_PUBLIC_URL: 'http://localhost:7070',
    STOREFRONT_URL: 'http://localhost:7072',
    OPENRENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    OPENRENT_SESSION_SECRET: 'p'.repeat(40),
    AUTO_MIGRATE: 'false',
    LOG_LEVEL: 'error',
  });
  const deps = await bootstrap(config, quiet, { migrate: false, poolSize: 1, themes: false });
  for (const p of opts.plugins) {
    const status = await deps.plugins.register(p);
    if (status.state !== 'loaded') throw new Error(`plugin ${p.id} did not load: ${status.error ?? status.state}`);
  }
  const m = await migratePlugins(pg.url, deps.plugins.migrations);
  if (m.refused.length) throw new Error(`plugin migration refused: ${JSON.stringify(m.refused)}`);
  const app = await buildApp(deps, { logger: false });
  await app.ready();

  const cookies = new Map<string, string>();
  const request = async (method: string, url: string, body?: unknown) => {
    const res = await app.inject({
      method: method as any,
      url,
      payload: body as any,
      headers: {
        ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(cookies.get('or_csrf') ? { 'x-csrf-token': cookies.get('or_csrf')! } : {}),
      },
    });
    for (const c of res.cookies as { name: string; value: string }[]) cookies.set(c.name, c.value);
    let json: any;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, body: json };
  };
  const setup = await request('POST', '/api/v1/setup', {
    owner: { email: 'owner@plugin.test', password: 'password123', name: 'Owner' },
    tenant: { name: 'Plugin Test Rentals', currency: opts.currency ?? 'EUR', timezone: opts.timezone ?? 'Europe/Tallinn' },
    location: { name: 'Main' },
    tax: { name: 'VAT', rate_bp: 2000 },
  });
  if (setup.status !== 201) throw new Error(`test shop setup failed: ${JSON.stringify(setup.body)}`);
  const tenantId: string = setup.body.tenant_id;
  await request('PATCH', `/api/v1/locations/${setup.body.location_id}`, { opening_hours: {} });

  const inShop = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: deps.plugins, secrets: deps.secrets, config: { publicUrl: config.publicUrl, adminUrl: config.adminUrl, storefrontUrl: config.storefrontUrl, livemode: false }, logger: quiet }),
    );

  return {
    tenantId,
    locationId: setup.body.location_id,
    request,
    get: (url) => request('GET', url),
    post: (url, body = {}) => request('POST', url, body),
    patch: (url, body) => request('PATCH', url, body),
    async runSchedule(pluginId, name) {
      const job = deps.plugins.schedules.find((s) => s.pluginId === pluginId && s.name === name);
      if (!job) throw new Error(`no schedule ${name} in plugin ${pluginId}`);
      await inShop((ctx) => deps.plugins.runSchedule(job, hookContext(ctx)));
    },
    inShop,
    async close() {
      await app.close();
      await deps.db.close();
      await pg.stop();
    },
  };
}
