import type { Ctx } from '../context.ts';
import { makeCrud } from '../crud.ts';
import { invalid, type FieldError } from '../errors.ts';
import { t as msg, currentLocale } from '../i18n/index.ts';
import { many } from '../sql.ts';

/**
 * Custom field definitions (FR-CAT-1, FR-OR-13, FR-PLG-4, FR-I18N-4): typed, validated extra fields on
 * products, units, customers and orders, with labels and options in every shop language. Keys starting
 * with `plg_` belong to plugins and are left to them.
 */
export type Entity = 'product' | 'stock_item' | 'customer' | 'order';
export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect' | 'url';
export const ENTITIES: Entity[] = ['product', 'stock_item', 'customer', 'order'];
export const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'boolean', 'date', 'select', 'multiselect', 'url'];

export interface Definition {
  id: string;
  entity: Entity;
  key: string;
  type: FieldType;
  required: boolean;
  options: { value: string; labels: Record<string, string> }[];
  labels: Record<string, string>;
  help: Record<string, string>;
  position: number;
  visibility: 'internal' | 'storefront' | 'portal';
  plugin_id: string | null;
}

export function definitionToApi(r: any) {
  return {
    id: r.id, object: 'custom_field_definition', entity: r.entity, key: r.key, type: r.type, required: r.required, options: r.options, labels: r.labels, help: r.help,
    position: r.position, visibility: r.visibility, plugin_id: r.plugin_id, created_at: r.created_at, updated_at: r.updated_at,
  };
}

const MAX_TEXT = 2000;

function checkDefinition(data: Record<string, any>, existing: any | null) {
  const errors: FieldError[] = [];
  const type = data.type ?? existing?.type;
  // The key and entity name the stored values; changing them would orphan data.
  if (existing && data.key !== undefined && data.key !== existing.key) errors.push({ field: 'key', code: 'immutable', message: msg('customfields.key_immutable') });
  if (existing && data.entity !== undefined && data.entity !== existing.entity) errors.push({ field: 'entity', code: 'immutable', message: msg('customfields.key_immutable') });
  const key = data.key ?? existing?.key;
  if (typeof key === 'string' && key.startsWith('plg_') && !(data.plugin_id ?? existing?.plugin_id)) errors.push({ field: 'key', code: 'reserved', message: msg('customfields.key_reserved') });
  const options = data.options ?? existing?.options ?? [];
  if (type === 'select' || type === 'multiselect') {
    if (!options.length) errors.push({ field: 'options', code: 'required', message: msg('customfields.options_required') });
    const values = options.map((o: any) => String(o?.value ?? '').trim());
    if (values.some((v: string) => !v) || new Set(values).size !== values.length) errors.push({ field: 'options', code: 'invalid', message: msg('customfields.options_unique') });
  }
  if (errors.length) throw invalid(msg('error.check_the_highlighted_fields'), errors);
}

export const definitions = makeCrud({
  table: 'custom_field_definitions',
  prefix: 'cfd',
  entity: 'custom_field_definition',
  event: 'custom_field_definition',
  softDelete: true,
  columns: { entity: {}, key: {}, type: {}, required: {}, options: { json: true }, labels: { json: true }, help: { json: true }, position: {}, visibility: {}, plugin_id: {} },
  list: { sorts: { position: 'position', created_at: 'created_at' }, defaultSort: 'position', filters: { entity: 'entity' } },
  toApi: definitionToApi,
  beforeWrite: (_ctx, data, existing) => checkDefinition(data, existing),
});

export async function definitionsFor(ctx: Ctx, entity: Entity): Promise<Definition[]> {
  return many<Definition>(ctx, `SELECT * FROM custom_field_definitions WHERE entity = $1 AND deleted_at IS NULL ORDER BY position, created_at`, [entity]);
}

/** A label in `locale`, else the shop's English or first label, else the key. */
export function labelFor(labels: Record<string, string> | undefined, locale: string, fallback: string): string {
  const v = labels?.[locale]?.trim() || labels?.en?.trim() || Object.values(labels ?? {}).find((x) => x?.trim());
  return v || fallback;
}

/**
 * Checks and normalises a record's custom field values against the definitions. Values for unknown keys
 * are refused (plugin `plg_` keys excepted); errors point at `custom_fields.<key>`.
 */
export async function validateCustomFields(ctx: Ctx, entity: Entity, values: Record<string, unknown> | null | undefined): Promise<Record<string, unknown>> {
  const input = values ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) throw invalid(msg('customfields.invalid'), [{ field: 'custom_fields', code: 'invalid', message: msg('customfields.invalid') }]);
  const defs = await definitionsFor(ctx, entity);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: FieldError[] = [];
  const out: Record<string, unknown> = {};
  const fail = (key: string, code: string, m: string) => errors.push({ field: `custom_fields.${key}`, code, message: m });
  for (const [key, raw] of Object.entries(input)) {
    if (key.startsWith('plg_')) {
      out[key] = raw;
      continue;
    }
    const d = byKey.get(key);
    if (!d) {
      fail(key, 'unknown_field', msg('customfields.unknown', { key }));
      continue;
    }
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) continue;
    const allowed = new Set(d.options.map((o) => o.value));
    switch (d.type) {
      case 'text':
      case 'textarea':
        if (typeof raw !== 'string') fail(key, 'not_text', msg('customfields.not_text'));
        else if (raw.length > MAX_TEXT) fail(key, 'too_long', msg('customfields.too_long', { max: MAX_TEXT }));
        else out[key] = d.type === 'text' ? raw.trim() : raw;
        break;
      case 'number': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.replace(',', '.')) : NaN;
        if (!Number.isFinite(n)) fail(key, 'not_number', msg('customfields.not_number'));
        else out[key] = n;
        break;
      }
      case 'boolean':
        if (typeof raw === 'boolean') out[key] = raw;
        else if (raw === 'true' || raw === 'false') out[key] = raw === 'true';
        else fail(key, 'not_boolean', msg('customfields.not_boolean'));
        break;
      case 'date':
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) fail(key, 'not_date', msg('customfields.not_date'));
        else out[key] = raw;
        break;
      case 'url':
        if (typeof raw !== 'string' || !/^https?:\/\/\S+$/i.test(raw.trim())) fail(key, 'not_url', msg('customfields.not_url'));
        else out[key] = raw.trim();
        break;
      case 'select':
        if (typeof raw !== 'string' || !allowed.has(raw)) fail(key, 'not_option', msg('customfields.not_option'));
        else out[key] = raw;
        break;
      case 'multiselect': {
        const list = Array.isArray(raw) ? raw : [raw];
        if (!list.every((x) => typeof x === 'string' && allowed.has(x))) fail(key, 'not_option', msg('customfields.not_option'));
        else out[key] = [...new Set(list as string[])];
        break;
      }
    }
  }
  // Shoppers and system jobs cannot fill fields they never see; staff and API clients must.
  const enforceRequired = ctx.actor.type === 'user' || ctx.actor.type === 'api_key' || ctx.actor.type === 'app';
  for (const d of defs) if (enforceRequired && d.required && out[d.key] === undefined && !errors.some((e) => e.field === `custom_fields.${d.key}`)) fail(d.key, 'required', msg('customfields.required', { label: labelFor(d.labels, currentLocale(), d.key) }));
  if (errors.length) throw invalid(msg('error.check_the_highlighted_fields'), errors);
  return out;
}

/**
 * The fields of a record that customers may see, with labels and option names in `locale`
 * (`storefront` on product pages, `portal` in the account).
 */
export async function visibleFields(ctx: Ctx, entity: Entity, values: Record<string, unknown> | null | undefined, audience: 'storefront' | 'portal', locale: string) {
  const defs = (await definitionsFor(ctx, entity)).filter((d) => d.visibility === audience || (audience === 'portal' && d.visibility === 'storefront'));
  const out: { key: string; label: string; type: FieldType; value: unknown; display: string }[] = [];
  for (const d of defs) {
    const v = values?.[d.key];
    if (v === undefined || v === null || v === '') continue;
    const option = (x: unknown) => labelFor(d.options.find((o) => o.value === x)?.labels, locale, String(x));
    const display = d.type === 'select' ? option(v) : d.type === 'multiselect' ? (v as unknown[]).map(option).join(', ') : d.type === 'boolean' ? msg(v ? 'customfields.yes' : 'customfields.no', {}, locale) : String(v);
    out.push({ key: d.key, label: labelFor(d.labels, locale, d.key), type: d.type, value: v, display });
  }
  return out;
}

const TAG_TABLES = { product: 'products', order: 'orders', customer: 'customers' } as const;

/** Tags already used on products, orders or customers, most used first, for suggestions. */
export async function tagsFor(ctx: Ctx, entity: keyof typeof TAG_TABLES, q?: string) {
  const rows = await many<{ tag: string; n: number }>(
    ctx,
    `SELECT tag, count(*)::int AS n FROM ${TAG_TABLES[entity]}, unnest(tags) AS tag WHERE ($1 = '' OR tag ILIKE '%' || $1 || '%') GROUP BY tag ORDER BY n DESC, tag LIMIT 50`,
    [q?.trim() ?? ''],
  );
  return rows.map((r) => ({ tag: r.tag, count: r.n }));
}
