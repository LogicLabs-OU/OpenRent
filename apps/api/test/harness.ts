import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { migrate } from '@openrent/db';
import { loadConfig } from '../src/config.ts';
import { bootstrap } from '../src/bootstrap.ts';
import { buildApp } from '../src/app.ts';
import type { AppDeps } from '../src/deps.ts';

/**
 * Integration harness. Uses DATABASE_URL_TEST (a throwaway PostgreSQL 16 database whose name
 * contains "test"; it is wiped) or, with TEST_PGLITE=1, an in-process PGlite server.
 */
export async function databaseForTests(): Promise<{ url: string; real: boolean; stop: () => Promise<void> } | null> {
  const url = process.env.DATABASE_URL_TEST;
  if (url) {
    if (!/test/i.test(new URL(url).pathname)) throw new Error('DATABASE_URL_TEST must point to a database whose name contains "test"; it is wiped');
    return { url, real: true, stop: async () => undefined };
  }
  if (process.env.TEST_PGLITE === '1') {
    const { startPglite } = await import('@openrent/db/dev/pglite');
    const port = 5600 + Math.floor(Math.random() * 300);
    // A second connection for migration runners (plugin migrations, restore); the app itself uses one.
    const s = await startPglite({ port, maxConnections: 3 });
    return { url: s.url, real: false, stop: s.stop };
  }
  return null;
}

/** Empties the throwaway test database and migrates it from scratch. */
export async function resetDatabase(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await c.end();
  await migrate(url, { log: () => undefined });
}

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  close(): Promise<void>;
}

export async function startApp(url: string, poolSize: number): Promise<TestApp> {
  const config = loadConfig({
    DATABASE_URL: url,
    OPENRENT_PUBLIC_URL: 'http://localhost:7070',
    STOREFRONT_URL: 'http://localhost:7072',
    OPENRENT_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OPENRENT_SESSION_SECRET: 'x'.repeat(40),
    AUTO_MIGRATE: 'false',
    LOG_LEVEL: 'error',
  });
  const quiet = { info() {}, warn() {}, error: (o: unknown, m?: string) => console.error(m, o), debug() {} };
  const deps = await bootstrap(config, quiet, { migrate: false, poolSize });
  const app = await buildApp(deps, { logger: false });
  await app.ready();
  return { app, deps, close: async () => { await app.close(); await deps.db.close(); } };
}

/** Cookie-aware client around app.inject with CSRF handling. */
export class Client {
  cookies = new Map<string, string>();
  constructor(readonly app: FastifyInstance, readonly headers: Record<string, string> = {}) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.app.inject({
      method: method as any,
      url,
      payload: body === undefined ? undefined : (body as any),
      headers: { ...this.headers, ...(cookie ? { cookie } : {}), ...(this.cookies.get('or_csrf') ? { 'x-csrf-token': this.cookies.get('or_csrf')! } : {}), ...headers },
    });
    for (const c of res.cookies as { name: string; value: string }[]) this.cookies.set(c.name, c.value);
    let json: any;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, body: json, headers: res.headers };
  }
  /** multipart/form-data upload of one file in the field "file". */
  async upload(url: string, filename: string, contentType: string, data: Buffer) {
    const boundary = `----openrent${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.req('POST', url, body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }

  get(url: string, headers: Record<string, string> = {}) {
    return this.req('GET', url, undefined, headers);
  }
  post(url: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return this.req('POST', url, body, headers);
  }
  patch(url: string, body: unknown, headers: Record<string, string> = {}) {
    return this.req('PATCH', url, body, headers);
  }
  put(url: string, body: unknown) {
    return this.req('PUT', url, body);
  }
  del(url: string) {
    return this.req('DELETE', url);
  }
}

export const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** ISO time `offsetDays` from now at `hour`:00 UTC. */
export function isoIn(offsetDays: number, hour = 10) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/**
 * A fresh database with a shop that is set up and signed in: owner owner@test.dev, one location open
 * all hours, VAT 20 %, Europe/Tallinn. Each test file calls this once, so files do not share state.
 */
export async function shopForTests(db: { url: string; real: boolean }) {
  await resetDatabase(db.url);
  const t = await startApp(db.url, db.real ? 20 : 1);
  const admin = new Client(t.app);
  const r = await admin.post('/api/v1/setup', {
    owner: { email: 'owner@test.dev', password: 'password123', name: 'Owner' },
    tenant: { name: 'Test Rentals', currency: 'EUR', timezone: 'Europe/Tallinn' },
    location: { name: 'Main shop' },
    tax: { name: 'VAT', rate_bp: 2000 },
  });
  if (r.status !== 201) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
  await admin.patch(`/api/v1/locations/${r.body.location_id}`, { opening_hours: {} });
  return { t, admin, tenantId: r.body.tenant_id as string, locationId: r.body.location_id as string, publishableKey: r.body.publishable_key as string };
}
