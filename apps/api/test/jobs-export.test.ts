import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { EXPORT_DENYLIST, REDACTED_COLUMNS, jobs, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { definePlugin, type StorageProvider } from '@openrent/plugin-sdk';
import { backup, restore, type Tools } from '../../../packages/cli/src/backup.ts';
import { runJobs } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('background jobs, the full data export and backups', () => {
  let t: TestApp;
  let admin: Client;
  let locationId: string;
  const cookie = () => [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const inTenant = <T>(id: string, fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, id, (c) =>
      fn({ db: c, tenantId: id, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false }, logger: quietLogger }),
    );

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('builds the export ZIP in the worker without secrets', async () => {
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Tent', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2500 } });
    await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${locationId}`, { quantity: 5 });
    const c = await admin.post('/api/v1/customers', { name: 'Export Person', email: 'export@test.dev' });
    const o = await admin.post('/api/v1/orders', { customer_id: c.body.id, starts_at: isoIn(2), ends_at: isoIn(3), lines: [{ variant_id: p.body.variants[0].id, quantity: 1 }] });
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    const inv = await admin.post(`/api/v1/orders/${o.body.id}/documents`, { type: 'invoice' });
    const att = await admin.upload('/api/v1/files?purpose=attachment', 'Agreement.pdf', 'application/pdf', Buffer.from('%PDF-1.4 export test'));
    await admin.post('/api/v1/webhook_endpoints', { url: 'https://hooks.example.com/export', events: ['*'] });

    const job = await admin.post('/api/v1/tenant/export');
    expect(job.status).toBe(202);
    expect(job.body).toMatchObject({ object: 'job', kind: 'tenant_export', status: 'queued', progress: 0 });
    // A second request while one is waiting returns the same job.
    expect((await admin.post('/api/v1/tenant/export')).body.id).toBe(job.body.id);
    expect((await admin.get(`/api/v1/jobs/${job.body.id}/download`)).status).toBe(409);

    expect(await runJobs(t.deps, quietLogger)).toBe(1);
    const done = await admin.get(`/api/v1/jobs/${job.body.id}`);
    expect(done.body).toMatchObject({ status: 'succeeded', progress: 100, result: { filename: expect.stringMatching(/^openrent-export-\d{4}-\d{2}-\d{2}\.zip$/) } });

    const dl = await t.app.inject({ method: 'GET', url: `/api/v1/jobs/${job.body.id}/download`, headers: { cookie: cookie() } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/zip');
    const zip = unzipSync(new Uint8Array(dl.rawPayload));
    const manifest = JSON.parse(strFromU8(zip['manifest.json']!));
    const tables = manifest.tables.map((x: any) => x.name);
    expect(tables).toEqual(expect.arrayContaining(['tenants', 'customers', 'orders', 'order_lines', 'documents', 'files', 'attachments', 'users', 'jobs']));
    for (const denied of EXPORT_DENYLIST) expect(tables).not.toContain(denied);
    expect(strFromU8(zip['tables/customers.ndjson']!)).toContain('export@test.dev');
    expect(strFromU8(zip['tables/customers.csv']!).split('\r\n')[0]).toContain('email');
    expect(strFromU8(zip['tables/orders.ndjson']!)).not.toContain('public_token');
    expect(strFromU8(zip['tables/webhook_endpoints.ndjson']!)).not.toContain('secret_encrypted');
    expect(strFromU8(zip['tables/users.ndjson']!)).not.toContain('password_hash');
    expect(strFromU8(zip['tables/files.ndjson']!)).not.toContain('"data"');
    const doc = manifest.documents.find((d: any) => d.id === inv.body.id);
    expect(strFromU8(zip[doc.path]!)).toContain('<html');
    const file = manifest.files.find((f: any) => f.id === att.body.id);
    expect(strFromU8(zip[file.path]!)).toBe('%PDF-1.4 export test');
    expect(file.sha256).toBe(file.expected_sha256);
    for (const entry of manifest.tables.flatMap((x: any) => x.files)) expect(zip[entry.path]!.length).toBe(entry.size);

    // The owner hears about it; the file itself is not reachable through /files.
    expect((await admin.get('/api/v1/me/notifications')).body.data[0]).toMatchObject({ kind: 'staff_export_ready', entity_type: 'job', entity_id: job.body.id });
    const fileId = (await withSystem(t.deps.db, (db) => db.query(`SELECT result_file_id FROM jobs WHERE id = $1`, [job.body.id]))).rows[0].result_file_id;
    expect((await admin.get(`/api/v1/files/${fileId}/content`)).status).toBe(404);
    const events = await withSystem(t.deps.db, (db) => db.query(`SELECT 1 FROM outbox WHERE event_type = 'export.completed'`));
    expect(events.rows).toHaveLength(1);
  });

  it('never exports a column that looks like a credential unless it is redacted', async () => {
    const rows = (
      await withSystem(t.deps.db, (db) =>
        db.query<{ table_name: string; column_name: string }>(
          `SELECT c.table_name, c.column_name FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.column_name ~ '(secret|token|password|_hash|encrypted|totp)'
              AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' UNION SELECT 'users')`,
        ),
      )
    ).rows;
    const leaks = rows.filter((r) => !EXPORT_DENYLIST.includes(r.table_name) && !REDACTED_COLUMNS.has(r.column_name) && !['secret_rotated_at', 'verification_token', 'file_hashes', 'totp_last_step'].includes(r.column_name));
    expect(leaks).toEqual([]);
    // Every left-out table still exists, so the list does not go stale.
    const tables = (await withSystem(t.deps.db, (db) => db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`))).rows.map((r) => r.table_name);
    for (const denied of EXPORT_DENYLIST) expect(tables).toContain(denied);
  });

  it('exports a report in the background and retries jobs a stopped worker left behind', async () => {
    expect((await admin.post('/api/v1/reports/nope/export', { format: 'csv' })).status).toBe(422);
    const job = await admin.post('/api/v1/reports/revenue/export', { format: 'xlsx', group_by: 'month' });
    expect(job.status).toBe(202);
    await runJobs(t.deps, quietLogger);
    const dl = await t.app.inject({ method: 'GET', url: `/api/v1/jobs/${job.body.id}/download`, headers: { cookie: cookie() } });
    expect(dl.headers['content-type']).toContain('spreadsheetml');
    expect(dl.headers['content-disposition']).toMatch(/revenue-\d{4}-\d{2}-\d{2}\.xlsx/);
    expect((await admin.get('/api/v1/jobs?kind=report_export')).body.data[0]).toMatchObject({ id: job.body.id, status: 'succeeded' });

    const stale = await admin.post('/api/v1/reports/overdue/export', {});
    await withSystem(t.deps.db, (db) => db.query(`UPDATE jobs SET status = 'running', attempts = 1, started_at = now() - interval '2 hours' WHERE id = $1`, [stale.body.id]));
    const reclaimed = await withSystem(t.deps.db, (db) => jobs.claimJobs(db, 5));
    expect(reclaimed.map((j) => j.id)).toContain(stale.body.id);
    expect(reclaimed.find((j) => j.id === stale.body.id)!.attempts).toBe(2);
    await withSystem(t.deps.db, (db) => db.query(`UPDATE jobs SET started_at = now() - interval '2 hours', attempts = 3 WHERE id = $1`, [stale.body.id]));
    await withSystem(t.deps.db, (db) => jobs.claimJobs(db, 5));
    expect((await admin.get(`/api/v1/jobs/${stale.body.id}`)).body).toMatchObject({ status: 'failed', error: expect.stringContaining('worker stopped') });
  });

  it('backs up the database and stored files, and puts missing objects back on restore', async () => {
    const objects = new Map<string, Buffer>();
    const store: StorageProvider = {
      id: 'memstore',
      isConfigured: () => true,
      put: async (_c, key, body) => void objects.set(key, Buffer.from(body)),
      get: async (_c, key) => objects.get(key) ?? Promise.reject(new Error('missing')),
      delete: async (_c, key) => void objects.delete(key),
      head: async (_c, key) => objects.has(key),
    };
    await t.deps.plugins.register(definePlugin({ id: 'memstore', name: 'Memory store', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerStorageProvider(store) }));
    const up = await admin.upload('/api/v1/files?purpose=attachment', 'Insurance.pdf', 'application/pdf', Buffer.from('%PDF-1.4 stored outside'));
    expect(objects.size).toBe(1);

    // Stand-ins for pg_dump and pg_restore: the dump is a file; restoring changes nothing here.
    const bin = await mkdtemp(path.join(tmpdir(), 'openrent-bin-'));
    const pgDump = path.join(bin, 'pg_dump');
    await writeFile(pgDump, `#!/bin/sh\nfor a in "$@"; do case "$a" in --file=*) printf 'dump' > "\${a#--file=}";; esac; done\n`);
    const pgRestore = path.join(bin, 'pg_restore');
    await writeFile(pgRestore, '#!/bin/sh\nexit 0\n');
    await chmod(pgDump, 0o755);
    await chmod(pgRestore, 0o755);
    const lines: string[] = [];
    const tools: Tools = { db: t.deps.db, tenantCtx: inTenant, databaseUrl: dbinfo!.url, say: (l) => lines.push(l) };

    const out = path.join(await mkdtemp(path.join(tmpdir(), 'openrent-backup-')), 'b1');
    const m = await backup(tools, { out, withFiles: true, pgDump });
    expect(m.database).toMatchObject({ file: 'database.dump', size: 4 });
    expect(m.migrations.length).toBeGreaterThan(10);
    const entry = m.files.find((f) => f.id === up.body.id)!;
    expect(entry).toMatchObject({ storage: 'memstore', copy: `files/${up.body.id}` });
    expect(await readFile(path.join(out, entry.copy!), 'utf8')).toBe('%PDF-1.4 stored outside');
    await expect(backup(tools, { out, pgDump })).rejects.toThrow(/not empty/);

    objects.clear();
    const r = await restore(tools, { dir: out, pgRestore, checkOnly: true });
    expect(r.rewritten).toEqual([up.body.id]);
    expect(r.problems).toEqual([]);
    expect(objects.get(entry.key!)?.toString()).toBe('%PDF-1.4 stored outside');
    // A full restore also runs migrations on a second connection, which the one-connection PGlite server refuses.
    if (dbinfo!.real) expect((await restore(tools, { dir: out, pgRestore })).restored).toBe(true);

    await writeFile(path.join(out, 'database.dump'), 'tampered');
    await expect(restore(tools, { dir: out, pgRestore, checkOnly: true })).rejects.toThrow(/damaged/);
  });
});
