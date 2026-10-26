import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { files, type Ctx } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import { definePlugin, type StorageProvider } from '@openrent/plugin-sdk';
import { publishOutbox } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** An object store in memory; `down` makes every call fail like an unreachable server. */
function memoryStore() {
  const objects = new Map<string, Buffer>();
  const state = { down: false };
  const check = () => {
    if (state.down) throw new Error('store unreachable');
  };
  const provider: StorageProvider = {
    id: 'mem',
    isConfigured: () => true,
    async put(_c, key, body) {
      check();
      objects.set(key, Buffer.from(body));
    },
    async get(_c, key) {
      check();
      const b = objects.get(key);
      if (!b) throw new Error('missing');
      return b;
    },
    async delete(_c, key) {
      check();
      objects.delete(key);
    },
    async head(_c, key) {
      check();
      return objects.has(key);
    },
  };
  return { objects, state, provider };
}

suite('object storage', () => {
  let t: TestApp;
  let admin: Client;
  let tenantId: string;
  const store = memoryStore();
  const png = async (colour: string) => (await import('sharp')).default({ create: { width: 64, height: 48, channels: 3, background: colour } }).png().toBuffer();
  /** A core context inside one tenant transaction, as the worker builds it. */
  const inTenant = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    withTenant(t.deps.db, tenantId, (c) =>
      fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: t.deps.plugins, secrets: t.deps.secrets, config: { publicUrl: '', adminUrl: '', storefrontUrl: '', livemode: false }, logger: quietLogger }),
    );

  beforeAll(async () => {
    ({ t, admin, tenantId } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('keeps files in the database until a store is set up, then moves them', async () => {
    const before = await admin.upload('/api/v1/files?purpose=image', 'early.png', 'image/png', await png('#111'));
    expect(before.status).toBe(201);
    await t.deps.plugins.register(definePlugin({ id: 'memstore', name: 'Memory store', version: '1.0.0', compat: '^1.0.0', setup: (api) => api.registerStorageProvider(store.provider) }));
    const moved = await inTenant((ctx) => files.migrateToStorage(ctx, 100));
    expect(moved).toBeGreaterThan(0);
    const row = (await withSystem(t.deps.db, (c) => c.query(`SELECT storage, key, data FROM files WHERE id = $1`, [before.body.id]))).rows[0];
    expect(row).toMatchObject({ storage: 'mem', data: null });
    expect(store.objects.has(row.key)).toBe(true);
    // Still served from its new home.
    const got = await admin.get(`/api/v1/files/${before.body.id}/content`);
    expect(got.status).toBe(200);
  });

  it('stores new uploads in the store and removes the bytes only after the delete commits', async () => {
    const up = await admin.upload('/api/v1/files?purpose=image', 'kayak.png', 'image/png', await png('#e11d48'));
    const rows = (await withSystem(t.deps.db, (c) => c.query(`SELECT id, key FROM files WHERE id = $1 OR owner_id = $1`, [up.body.id]))).rows;
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(store.objects.has(r.key)).toBe(true);

    // A delete that rolls back keeps both the row and the bytes.
    await expect(
      inTenant(async (ctx) => {
        await files.deleteFile(ctx, up.body.id);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect((await withSystem(t.deps.db, (c) => c.query(`SELECT 1 FROM files WHERE id = $1`, [up.body.id]))).rows).toHaveLength(1);
    for (const r of rows) expect(store.objects.has(r.key)).toBe(true);

    // A committed delete: the rows go at once, the bytes when the worker publishes the outbox.
    await inTenant((ctx) => files.deleteFile(ctx, up.body.id));
    expect((await withSystem(t.deps.db, (c) => c.query(`SELECT 1 FROM files WHERE id = $1 OR owner_id = $1`, [up.body.id]))).rows).toHaveLength(0);
    expect(store.objects.has(rows[0].key)).toBe(true);
    await publishOutbox(t.deps, quietLogger);
    for (const r of rows) expect(store.objects.has(r.key)).toBe(false);
  });

  it('retries a purge while the store is down', async () => {
    const up = await admin.upload('/api/v1/files?purpose=image', 'retry.png', 'image/png', await png('#0e7490'));
    const key = (await withSystem(t.deps.db, (c) => c.query(`SELECT key FROM files WHERE id = $1`, [up.body.id]))).rows[0].key;
    await inTenant((ctx) => files.deleteFile(ctx, up.body.id));
    store.state.down = true;
    try {
      await publishOutbox(t.deps, quietLogger);
      expect(store.objects.has(key)).toBe(true);
    } finally {
      store.state.down = false;
    }
    await publishOutbox(t.deps, quietLogger);
    expect(store.objects.has(key)).toBe(false);
  });

  it('reports missing objects and an unreachable store', async () => {
    const up = await admin.upload('/api/v1/files?purpose=image', 'lost.png', 'image/png', await png('#333'));
    const key = (await withSystem(t.deps.db, (c) => c.query(`SELECT key FROM files WHERE id = $1`, [up.body.id]))).rows[0].key;
    store.objects.delete(key);
    expect(await inTenant((ctx) => files.verifyStorage(ctx, 500))).toContain(up.body.id);
    expect((await admin.get('/api/v1/system/ready')).body).toMatchObject({ status: 'ready', storage: 'ok' });
    store.state.down = true;
    try {
      const r = await admin.get('/api/v1/system/ready');
      expect(r.status, JSON.stringify(r.body)).toBe(503);
      expect(r.body.storage).toBe('error');
    } finally {
      store.state.down = false;
    }
  });
});
