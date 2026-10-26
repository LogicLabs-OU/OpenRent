import type { MessageKey } from '../i18n/index.ts';

/** One cell parsed: a value, or a problem described by a message key. */
export type Parsed = { value: unknown } | { error: MessageKey; params?: Record<string, string | number> };

export interface Column {
  key: string;
  /** Header names recognised for this column (compared after normalising case, spaces and dashes). */
  aliases: string[];
  required?: boolean;
  parse?: (raw: string) => Parsed;
}

export type ImportEntity = 'products' | 'stock_items' | 'prices';

export const normaliseHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^\w]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

// --- Cell parsers -------------------------------------------------------------

/** "12.50", "12,50", "€ 1.234,50", "1,234.50" → minor units. */
export function parseMoney(raw: string): Parsed {
  let s = raw.replace(/[^\d,.-]/g, '');
  if (!s) return { error: 'imports.invalid_money' };
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal one; the other groups thousands.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { error: 'imports.invalid_money' };
  return { value: Math.round(n * 100) };
}

export function parseInteger(raw: string): Parsed {
  const n = Number(raw.replace(/\s/g, ''));
  return Number.isInteger(n) && n >= 0 ? { value: n } : { error: 'imports.invalid_integer' };
}

/** ISO dates, or day-first dates (31.12.2026, 31/12/2026) as used across Europe. */
export function parseDate(raw: string): Parsed {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validDate(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return validDate(+m[3]!, +m[2]!, +m[1]!);
  return { error: 'imports.invalid_date' };
}

function validDate(y: number, mo: number, d: number): Parsed {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { error: 'imports.invalid_date' };
  return { value: dt.toISOString().slice(0, 10) };
}

export const parseEnum =
  (map: Record<string, string>) =>
  (raw: string): Parsed => {
    const v = map[raw.trim().toLowerCase()];
    return v ? { value: v } : { error: 'imports.invalid_choice', params: { choices: [...new Set(Object.values(map))].join(', ') } };
  };

export const parseList = (raw: string): Parsed => ({ value: raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean) });

const TRACKING = parseEnum({ serialized: 'serialized', serialised: 'serialized', unit: 'serialized', units: 'serialized', individual: 'serialized', bulk: 'bulk', quantity: 'bulk', none: 'none', untracked: 'none' });
const TYPES = parseEnum({ rental: 'rental', rent: 'rental', sale: 'sale', sell: 'sale', service: 'service', consumable: 'consumable' });
const VISIBILITY = parseEnum({ public: 'public', visible: 'public', published: 'public', yes: 'public', true: 'public', hidden: 'hidden', no: 'hidden', false: 'hidden', draft: 'hidden', archived: 'archived' });
const PERIOD = parseEnum({ hour: 'hour', hourly: 'hour', h: 'hour', day: 'day', daily: 'day', d: 'day', week: 'week', weekly: 'week', w: 'week', month: 'month', monthly: 'month', m: 'month', fixed: 'fixed', rental: 'fixed', once: 'fixed' });
const CONDITION = parseEnum({ new: 'new', good: 'good', fair: 'fair', worn: 'worn', poor: 'poor' });

// --- Specs ----------------------------------------------------------------------

const sku: Column = { key: 'sku', aliases: ['sku', 'variant_sku', 'article_number', 'item_code', 'code', 'product_code'] };
const price: Column = { key: 'price', aliases: ['price', 'base_price', 'rate', 'price_per_day', 'day_price', 'rental_price', 'amount'], parse: parseMoney };
const period: Column = { key: 'price_period', aliases: ['price_period', 'period', 'per', 'price_unit', 'charge_period', 'billing_period'], parse: PERIOD };

export const SPECS: Record<ImportEntity, Column[]> = {
  products: [
    { key: 'name', aliases: ['name', 'product', 'product_name', 'title', 'item_name'], required: true },
    { key: 'slug', aliases: ['slug', 'handle', 'product_slug', 'url_key'] },
    { key: 'type', aliases: ['type', 'product_type', 'kind'], parse: TYPES },
    { key: 'description', aliases: ['description', 'body', 'details', 'product_description'] },
    { key: 'category', aliases: ['category', 'categories', 'product_category', 'collection'], parse: parseList },
    { key: 'tags', aliases: ['tags', 'labels', 'keywords'], parse: parseList },
    { key: 'visibility', aliases: ['visibility', 'status', 'published', 'visible'], parse: VISIBILITY },
    { key: 'deposit', aliases: ['deposit', 'deposit_amount', 'security_deposit'], parse: parseMoney },
    { key: 'variant', aliases: ['variant', 'variant_name', 'option', 'size'] },
    sku,
    { key: 'tracking', aliases: ['tracking', 'stock_tracking', 'tracking_mode', 'inventory_tracking'], parse: TRACKING },
    price,
    period,
    { key: 'buffer_after_min', aliases: ['buffer_after_min', 'buffer_after', 'turnaround', 'turnaround_minutes'], parse: parseInteger },
  ],
  stock_items: [
    { ...sku, required: true },
    { key: 'barcode', aliases: ['barcode', 'asset_tag', 'tag', 'ean', 'qr'] },
    { key: 'serial', aliases: ['serial', 'serial_number', 'serial_no'] },
    { key: 'location', aliases: ['location', 'location_name', 'warehouse', 'store'] },
    { key: 'quantity', aliases: ['quantity', 'qty', 'stock', 'count', 'on_hand'], parse: parseInteger },
    { key: 'condition', aliases: ['condition', 'grade', 'condition_grade'], parse: CONDITION },
    { key: 'purchase_date', aliases: ['purchase_date', 'purchased', 'bought_on', 'date_purchased'], parse: parseDate },
    { key: 'purchase_price', aliases: ['purchase_price', 'cost', 'purchase_cost'], parse: parseMoney },
    { key: 'notes', aliases: ['notes', 'note', 'comments', 'remarks'] },
    { key: 'bin', aliases: ['bin', 'shelf', 'zone', 'storage_location', 'location_code'] },
  ],
  prices: [
    { ...sku, required: true },
    { ...price, required: true },
    period,
    { key: 'deposit', aliases: ['deposit', 'deposit_amount', 'security_deposit'], parse: parseMoney },
  ],
};

/** Header used when exporting each column (round-trips through import). */
export const exportHeaders = (entity: ImportEntity) => SPECS[entity].map((c) => c.key);

/** Maps the file's headers to column keys; unknown headers are reported and ignored. */
export function mapHeaders(entity: ImportEntity, headers: string[]) {
  const mapping: Record<number, string> = {};
  const unknown: string[] = [];
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const n = normaliseHeader(h);
    const col = SPECS[entity].find((c) => !used.has(c.key) && (c.key === n || c.aliases.includes(n)));
    if (col) {
      mapping[i] = col.key;
      used.add(col.key);
    } else if (h.trim()) unknown.push(h.trim());
  });
  const missing = SPECS[entity].filter((c) => c.required && !used.has(c.key)).map((c) => c.key);
  return { mapping, unknown, missing };
}
