import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HookContext } from '@openrent/plugin-sdk';
import { indexUid, meilisearchProvider, reindex, syncProduct, toDoc } from '../src/index.ts';

const row = {
  id: 'prd_1', name: 'Sea kayak', description: '<p>Stable &amp; dry</p>', translations: { de: { name: 'Seekajak' }, fr: {} },
  tags: ['water', ''], skus: ['KAY-1', null], categories: ['Boats'],
};
const config = { host: 'http://meili.test/', api_key: 'mk' };

/** A Meilisearch stand-in that records calls; every write is a task that has already succeeded. */
function server() {
  const calls: string[] = [];
  const bodies: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('http://meili.test', '');
    calls.push(`${init.method} ${path}`);
    bodies.push(init.body ? JSON.parse(String(init.body)) : undefined);
    const reply = path.startsWith('/tasks/') ? { status: 'succeeded' } : path.endsWith('/search') ? { hits: [{ id: 'prd_2' }, { id: 'prd_1' }] } : init.method === 'GET' ? { uid: 'x' } : { taskUid: calls.length };
    return { ok: true, status: 200, json: async () => reply };
  });
  return { calls, bodies };
}

function hookCtx(rows: any[]): HookContext {
  return {
    tenantId: 'ten_1', actor: { type: 'system', id: null }, logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    scope: { db: { query: async () => ({ rows }) }, services: {} as any, config: async () => config, secrets: { get: async () => null }, events: { emit: async () => {} } },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Meilisearch', () => {
  it('names one index per shop and builds plain documents', () => {
    expect(indexUid({}, 'ten_1')).toBe('openrent_ten_1');
    expect(indexUid({ index_prefix: 'shop.prod' }, 'ten_1')).toBe('shop_prod_ten_1');
    expect(toDoc(row)).toEqual({ id: 'prd_1', name: 'Sea kayak', names: ['Sea kayak', 'Seekajak'], description: 'Stable dry', skus: ['KAY-1'], tags: ['water'], categories: ['Boats'] });
  });

  it('returns product ids in Meilisearch’s order', async () => {
    const { calls, bodies } = server();
    expect(await meilisearchProvider.search({ tenantId: 'ten_1', config, logger: console as any }, { q: 'kajak', locale: 'de', limit: 20 })).toEqual(['prd_2', 'prd_1']);
    expect(calls).toEqual(['POST /indexes/openrent_ten_1/search']);
    expect(bodies[0]).toEqual({ q: 'kajak', limit: 20, attributesToRetrieve: ['id'] });
  });

  it('rebuilds into a fresh index and swaps it in', async () => {
    const { calls } = server();
    expect(await reindex(hookCtx([row]))).toBe(1);
    expect(calls.filter((c) => !c.startsWith('GET /tasks/'))).toEqual([
      'DELETE /indexes/openrent_ten_1_next', 'POST /indexes', 'PATCH /indexes/openrent_ten_1_next/settings', 'POST /indexes/openrent_ten_1_next/documents',
      'GET /indexes/openrent_ten_1', 'POST /swap-indexes', 'DELETE /indexes/openrent_ten_1_next',
    ]);
  });

  it('sends a changed product, and removes one that is no longer public', async () => {
    const { calls } = server();
    await syncProduct(hookCtx([row]), 'prd_1');
    await syncProduct(hookCtx([]), 'prd_9');
    expect(calls).toEqual(['POST /indexes/openrent_ten_1/documents', 'DELETE /indexes/openrent_ten_1/documents/prd_9']);
  });
});
