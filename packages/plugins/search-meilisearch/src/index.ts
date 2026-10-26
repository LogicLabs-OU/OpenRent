import { definePlugin, type DomainEvent, type HookContext, type ProviderContext, type SearchProvider } from '@openrent/plugin-sdk';

/**
 * Storefront search through Meilisearch: typo-tolerant, fast on large catalogues, matching product
 * names in every shop language, SKUs, tags and category names. Each shop has its own index. Product
 * changes are sent as they happen, and the whole catalogue is rebuilt every night (and on request)
 * into a fresh index that replaces the old one in one step, so search never sees half an index.
 */
const SEARCHABLE = ['name', 'names', 'skus', 'tags', 'categories', 'description'];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export interface ProductDoc {
  id: string;
  name: string;
  names: string[];
  description: string;
  skus: string[];
  tags: string[];
  categories: string[];
}

/** The shop's index: `<prefix>_<tenant>`, with only the characters Meilisearch allows. */
export const indexUid = (config: Record<string, unknown>, tenantId: string) => `${str(config.index_prefix) ?? 'openrent'}_${tenantId}`.replace(/[^a-zA-Z0-9_-]/g, '_');

/** HTML to plain text, short enough to index. */
const plain = (html: unknown) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

export function toDoc(row: any): ProductDoc {
  const translated = Object.values((row.translations ?? {}) as Record<string, { name?: string }>)
    .map((t) => t?.name)
    .filter((n): n is string => !!n);
  return {
    id: row.id, name: row.name, names: [...new Set([row.name, ...translated])], description: plain(row.description),
    skus: (row.skus ?? []).filter(Boolean), tags: (row.tags ?? []).filter(Boolean), categories: (row.categories ?? []).filter(Boolean),
  };
}

const PRODUCTS = `
  SELECT p.id, p.name, p.description, p.translations, p.tags,
    coalesce((SELECT array_agg(v.sku) FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL AND v.sku IS NOT NULL), '{}') AS skus,
    coalesce((SELECT array_agg(c.name) FROM product_categories pc JOIN categories c ON c.id = pc.category_id
              WHERE pc.product_id = p.id AND c.deleted_at IS NULL), '{}') AS categories
  FROM products p WHERE p.deleted_at IS NULL AND p.visibility = 'public'`;

async function meili(config: Record<string, unknown>, method: string, path: string, body?: unknown) {
  const host = str(config.host);
  if (!host) throw new Error('Meilisearch: no host set');
  const res = await fetch(`${host.replace(/\/$/, '')}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(str(config.api_key) ? { authorization: `Bearer ${config.api_key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meilisearch: ${data?.message ?? `HTTP ${res.status}`}`);
  return data;
}

/** Meilisearch applies writes as tasks; waits for one to finish (or fail). */
async function waitFor(config: Record<string, unknown>, task: { taskUid?: number }, timeoutMs = 45_000) {
  if (task?.taskUid === undefined) return;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const t = await meili(config, 'GET', `/tasks/${task.taskUid}`);
    if (t.status === 'succeeded') return;
    if (t.status === 'failed' || t.status === 'canceled') throw new Error(`Meilisearch: ${t.error?.message ?? t.status}`);
    if (Date.now() > until) throw new Error('Meilisearch: indexing took too long');
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Rebuilds the shop's index from scratch and swaps it in. Returns how many products went in. */
export async function reindex(ctx: HookContext) {
  const scope = ctx.scope!;
  const config = await scope.config();
  const uid = indexUid(config, ctx.tenantId);
  const fresh = `${uid}_next`;
  await meili(config, 'DELETE', `/indexes/${fresh}`).catch(() => undefined);
  await waitFor(config, await meili(config, 'POST', '/indexes', { uid: fresh, primaryKey: 'id' }));
  await waitFor(config, await meili(config, 'PATCH', `/indexes/${fresh}/settings`, { searchableAttributes: SEARCHABLE }));
  const docs = (await scope.db.query(PRODUCTS)).rows.map(toDoc);
  for (let i = 0; i < docs.length; i += 1000) await waitFor(config, await meili(config, 'POST', `/indexes/${fresh}/documents`, docs.slice(i, i + 1000)));
  // The live index must exist to be swapped; the first run creates it empty.
  await meili(config, 'GET', `/indexes/${uid}`).catch(async () => waitFor(config, await meili(config, 'POST', '/indexes', { uid, primaryKey: 'id' })));
  await waitFor(config, await meili(config, 'POST', '/swap-indexes', [{ indexes: [uid, fresh] }]));
  await meili(config, 'DELETE', `/indexes/${fresh}`).catch(() => undefined);
  ctx.logger.info({ products: docs.length }, 'meilisearch index rebuilt');
  return docs.length;
}

/** One product changed: send it again, or take it out when it is hidden or archived. */
export async function syncProduct(ctx: HookContext, productId: string) {
  const scope = ctx.scope!;
  const config = await scope.config();
  if (!str(config.host)) return;
  const uid = indexUid(config, ctx.tenantId);
  const row = (await scope.db.query(`${PRODUCTS} AND p.id = $1`, [productId])).rows[0];
  if (row) await meili(config, 'POST', `/indexes/${uid}/documents`, [toDoc(row)]);
  else await meili(config, 'DELETE', `/indexes/${uid}/documents/${encodeURIComponent(productId)}`).catch(() => undefined);
}

export const meilisearchProvider: SearchProvider = {
  id: 'meilisearch',
  isConfigured: (ctx) => !!str(ctx.config.host),
  async search(ctx: ProviderContext, req) {
    const r = await meili(ctx.config, 'POST', `/indexes/${indexUid(ctx.config, ctx.tenantId)}/search`, { q: req.q, limit: req.limit, attributesToRetrieve: ['id'] });
    return ((r?.hits ?? []) as { id: string }[]).map((h) => h.id);
  },
};

export default definePlugin({
  id: 'search-meilisearch',
  name: 'Meilisearch search',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.1.0',
  permissions: ['network', 'catalog:read'],
  settings: [
    { key: 'host', label: 'Meilisearch URL', type: 'text', required: true, help: 'e.g. https://search.example.com or a Meilisearch Cloud project URL' },
    { key: 'api_key', label: 'API key', type: 'secret', help: 'A key allowed to search, manage documents and indexes' },
    { key: 'index_prefix', label: 'Index prefix', type: 'text', help: 'Default "openrent"; change it when several installations share one server' },
  ],
  jobs: [{ name: 'reindex', cron: '23 3 * * *' }],
  setup(api) {
    api.setDefaultConfig({ host: api.env('MEILISEARCH_HOST'), api_key: api.env('MEILISEARCH_API_KEY') });
    api.registerSearchProvider(meilisearchProvider);
    const changed = (event: DomainEvent, ctx: HookContext) => {
      const o = event.data.object as { id: string; product_id?: string };
      return syncProduct(ctx, event.type.startsWith('variant.') ? o.product_id! : o.id);
    };
    for (const type of ['product.created', 'product.updated', 'product.archived', 'variant.created', 'variant.updated']) api.on(type, changed);
    api.schedule('reindex', '23 3 * * *', (ctx) => reindex(ctx).then(() => undefined));
    api.route({ method: 'POST', path: '/reindex', permission: 'catalog:write', handler: async (_req, ctx) => ({ object: 'result', indexed: await reindex(ctx) }) });
  },
});
