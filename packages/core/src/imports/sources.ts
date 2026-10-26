import { t } from '../i18n/index.ts';
import { invalid } from '../errors.ts';
import { isPrivateHost } from '../webhooks/sign.ts';
import { normaliseHeader, type ImportEntity } from './spec.ts';
import type { Sheet } from './index.ts';

/**
 * Other rental and asset systems as import sheets (FR-MIG-2), in OpenRent's own column names, so they
 * go through the same dry run and apply as files: Shelf.nu from its CSV export, Booqable and Snipe-IT
 * through their APIs.
 */
export const SOURCES = ['shelf', 'booqable', 'snipeit'] as const;
export type Source = (typeof SOURCES)[number];
export type SourceSheets = Partial<Record<ImportEntity, Sheet>>;

const PAGE = 100;
const MAX_PAGES = 200;
const money = (cents: unknown) => (cents == null || cents === '' ? '' : (Number(cents) / 100).toFixed(2));
/** Snipe-IT escapes text as HTML. */
const text = (v: unknown) => String(v ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
const slugish = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Self-hosted systems often sit on the shop's own network; a hosted OpenRent can refuse that. */
export const allowPrivateImports = () => process.env.IMPORTS_ALLOW_PRIVATE_NETWORK === 'true';

export function checkBaseUrl(raw: string, field = 'base_url') {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw invalid(t('error.enter_a_valid_url'), [{ field, code: 'invalid_url', message: t('error.enter_a_valid_url') }]);
  }
  const open = allowPrivateImports();
  if (!['https:', 'http:'].includes(u.protocol) || (!open && u.protocol !== 'https:')) throw invalid(t('error.field.use_an_https_url'), [{ field, code: 'https_required', message: t('error.field.use_an_https_url') }]);
  if (!open && isPrivateHost(u.hostname)) throw invalid(t('error.private_network_addresses_are_not_allowed'), [{ field, code: 'private_network', message: t('error.field.use_a_public_host') }]);
  return u.href.replace(/\/$/, '');
}

async function getJson(url: string, headers: Record<string, string>, what: string) {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Error(t('imports.source_unreachable', { source: what, error: String((e as Error).message ?? e) }), { cause: e });
  }
  if (res.status === 401 || res.status === 403) throw new Error(t('imports.source_refused', { source: what }));
  if (!res.ok) throw new Error(t('imports.source_error', { source: what, status: res.status }));
  return res.json();
}

// --- Shelf.nu ------------------------------------------------------------------------------

/**
 * Shelf.nu's asset export: one row per asset. Assets with the same name become one product counted
 * by unit; each asset a unit with its QR id as barcode and its valuation as purchase price.
 */
export function shelfSheets(sheet: Sheet, locationNames: string[]): SourceSheets {
  const col = (...names: string[]) => sheet.headers.findIndex((h) => names.includes(normaliseHeader(h)));
  const at = { name: col('name', 'title', 'asset_name'), description: col('description'), category: col('category'), location: col('location'), tags: col('tags'), value: col('valuation', 'value', 'price'), id: col('qr_id', 'qr_code_id', 'qr_code', 'asset_id', 'id') };
  if (at.name < 0) throw invalid(t('imports.missing_column', { column: 'Name' }), [{ field: 'file_id', code: 'missing_column', message: t('imports.missing_column', { column: 'Name' }) }]);
  const known = new Map(locationNames.map((l) => [l.trim().toLowerCase(), l]));
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const products = new Map<string, string[]>();
  const units: string[][] = [];
  for (const r of sheet.rows) {
    const name = cell(r, at.name);
    if (!name) continue;
    const sku = `SHELF-${slugish(name)}`;
    if (!products.has(sku)) products.set(sku, [name, sku, cell(r, at.category), cell(r, at.tags), cell(r, at.description), 'serialized', 'hidden', 'rental']);
    units.push([sku, cell(r, at.id), known.get(cell(r, at.location).toLowerCase()) ?? '', cell(r, at.value)]);
  }
  return {
    products: { headers: ['name', 'sku', 'category', 'tags', 'description', 'tracking', 'visibility', 'type'], rows: [...products.values()] },
    stock_items: { headers: ['sku', 'barcode', 'location', 'purchase_price'], rows: units },
  };
}

// --- Booqable -----------------------------------------------------------------------------------

/**
 * Booqable's REST API (v1): customers, product groups (products, with their price) and orders with
 * their lines, page by page, with the account's API key.
 */
export async function booqableSheets(opts: { company?: string; baseUrl?: string; apiKey: string }): Promise<SourceSheets> {
  const base = `${opts.baseUrl ?? `https://${opts.company}.booqable.com`}/api/1`;
  const all = async (path: string, key: string) => {
    const out: any[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await getJson(`${base}/${path}?page=${page}&per=${PAGE}&api_key=${encodeURIComponent(opts.apiKey)}`, {}, 'Booqable');
      const rows = (body?.[key] ?? []) as any[];
      out.push(...rows);
      if (rows.length < PAGE || (body?.meta?.total_count != null && out.length >= body.meta.total_count)) break;
    }
    return out;
  };
  const customers = await all('customers', 'customers');
  const groups = (await all('product_groups', 'product_groups')).filter((g) => !g.archived);
  const items = await all('products', 'products');
  const orders = await all('orders', 'orders');
  const groupSku = new Map(groups.map((g) => [g.id, String(g.sku || g.slug || g.id)]));
  // A line names the bookable item (a product), or the group itself.
  const skuOfItem = (id: string) => groupSku.get(id) ?? groupSku.get(items.find((p) => p.id === id)?.product_group_id) ?? null;
  const orderRows: string[][] = [];
  for (const o of orders) {
    if (!o.starts_at || !o.stops_at) continue;
    let lines = o.lines as any[] | undefined;
    if (!lines) lines = (await getJson(`${base}/orders/${encodeURIComponent(o.id)}?api_key=${encodeURIComponent(opts.apiKey)}`, {}, 'Booqable'))?.order?.lines ?? [];
    for (const l of lines ?? []) {
      const sku = skuOfItem(l.item_id ?? l.product_id ?? l.product_group_id);
      if (!sku) continue;
      orderRows.push([String(o.number ?? o.id), String(o.customer_id ?? ''), sku, String(l.quantity ?? 1), o.starts_at, o.stops_at, String(o.status ?? '')]);
    }
  }
  return {
    customers: {
      headers: ['name', 'email', 'phone', 'reference'],
      rows: customers.map((c) => [String(c.name ?? ''), String(c.email ?? ''), String(c.phone ?? c.properties?.find?.((p: any) => p.identifier === 'phone')?.value ?? ''), String(c.id)]),
    },
    products: {
      headers: ['name', 'slug', 'sku', 'description', 'tags', 'visibility', 'tracking', 'price', 'price_period', 'type'],
      rows: groups.map((g) => [
        String(g.name ?? ''), String(g.slug ?? ''), String(g.sku || g.slug || g.id), String(g.description ?? ''), (g.tag_list ?? []).join(', '), g.show_in_store ? 'public' : 'hidden',
        g.trackable ? 'serialized' : 'bulk', money(g.base_price_in_cents), String(g.price_period ?? 'day'), 'rental',
      ]),
    },
    orders: { headers: ['reference', 'customer_reference', 'sku', 'quantity', 'starts_at', 'ends_at', 'status'], rows: orderRows },
  };
}

// --- Snipe-IT -----------------------------------------------------------------------------------

/** Snipe-IT's API (v1): asset models become products, assets their units. Archived assets stay out. */
export async function snipeitSheets(opts: { baseUrl: string; token: string }, locationNames: string[]): Promise<SourceSheets> {
  const base = `${opts.baseUrl}/api/v1`;
  const headers = { authorization: `Bearer ${opts.token}` };
  const all = async (path: string) => {
    const out: any[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await getJson(`${base}/${path}?limit=${PAGE}&offset=${page * PAGE}`, headers, 'Snipe-IT');
      if (body?.status === 'error') throw new Error(t('imports.source_refused', { source: 'Snipe-IT' }));
      const rows = (body?.rows ?? []) as any[];
      out.push(...rows);
      if (rows.length < PAGE || out.length >= Number(body?.total ?? 0)) break;
    }
    return out;
  };
  const models = await all('models');
  const assets = (await all('hardware')).filter((a) => a.status_label?.status_meta !== 'archived');
  const skuOf = new Map(models.map((m) => [m.id, text(m.model_number) || `SNIPE-${m.id}`]));
  const known = new Map(locationNames.map((l) => [l.trim().toLowerCase(), l]));
  return {
    products: {
      headers: ['name', 'sku', 'category', 'tracking', 'visibility', 'type'],
      rows: models.map((m) => [text(m.name), skuOf.get(m.id)!, text(m.category?.name), 'serialized', 'hidden', 'rental']),
    },
    stock_items: {
      headers: ['sku', 'barcode', 'serial', 'location', 'purchase_date', 'purchase_price', 'notes'],
      rows: assets
        .filter((a) => skuOf.has(a.model?.id))
        .map((a) => [
          skuOf.get(a.model.id)!, text(a.asset_tag), text(a.serial), known.get(text(a.location?.name ?? a.rtd_location?.name).toLowerCase()) ?? '',
          String(a.purchase_date?.date ?? '').slice(0, 10), text(a.purchase_cost), text(a.notes),
        ]),
    },
  };
}
