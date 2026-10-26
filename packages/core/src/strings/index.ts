import { LOCALES, shapeProblem, type Locale } from '@openrent/i18n';
import type { Ctx } from '../context.ts';
import { invalid, notFound, type FieldError } from '../errors.ts';
import { audit } from '../events.ts';
import { serverCatalogs, t } from '../i18n/index.ts';
import { exec, many } from '../sql.ts';

/**
 * A shop's own wording (FR-I18N-6). Each namespace is a set of built-in texts by language: the
 * storefront's, each theme's (`theme:<id>`), each plugin's (`plugin:<id>`), and the server texts used
 * in emails and documents. Overrides keep the built-in text's placeholders, or they are refused.
 */
export interface StringNamespace {
  id: string;
  kind: 'storefront' | 'theme' | 'plugin' | 'email' | 'documents';
  name: string;
  catalogs: Partial<Record<string, Record<string, string>>>;
}

const stringsOnly = (cat: Record<string, unknown>) => Object.fromEntries(Object.entries(cat).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string')) as Record<string, string>;

/** Server texts of emails (`email.*`) and documents (`document.*`). */
export function serverNamespaces(): StringNamespace[] {
  const pick = (prefix: string) => Object.fromEntries(Object.entries(serverCatalogs()).map(([l, cat]) => [l, Object.fromEntries(Object.entries(stringsOnly(cat)).filter(([k]) => k.startsWith(prefix)))]));
  return [
    { id: 'email', kind: 'email', name: 'email', catalogs: pick('email.') },
    { id: 'documents', kind: 'documents', name: 'documents', catalogs: pick('document.') },
  ];
}

export function namespaceFrom(id: string, kind: StringNamespace['kind'], name: string, catalogs: Record<string, Record<string, unknown>>): StringNamespace {
  return { id, kind, name, catalogs: Object.fromEntries(Object.entries(catalogs).map(([l, c]) => [l, stringsOnly(c)])) };
}

/** The shop's overrides in one namespace and language. */
export async function overridesFor(ctx: Ctx, namespace: string, locale: string): Promise<Record<string, string>> {
  const rows = await many<{ key: string; value: string }>(ctx, `SELECT key, value FROM string_overrides WHERE namespace = $1 AND locale = $2`, [namespace, locale]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** The shop's overrides in one namespace for every language (theme texts on the storefront). */
export async function overridesByLocale(ctx: Ctx, namespace: string): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const r of await many<{ locale: string; key: string; value: string }>(ctx, `SELECT locale, key, value FROM string_overrides WHERE namespace = $1`, [namespace])) (out[r.locale] ??= {})[r.key] = r.value;
  return out;
}

/** Built-in texts of a namespace in a language, English where the language has none. */
function base(ns: StringNamespace, locale: string) {
  return { ...(ns.catalogs.en ?? {}), ...(ns.catalogs[locale] ?? {}) };
}

export async function listStrings(ctx: Ctx, ns: StringNamespace, q: { locale: string; q?: string; changed?: boolean; limit?: number; offset?: number }) {
  if (!LOCALES.includes(q.locale as Locale)) throw invalid(t('strings.bad_locale'), [{ field: 'locale', code: 'invalid', message: t('strings.bad_locale') }]);
  const texts = base(ns, q.locale);
  const own = await overridesFor(ctx, ns.id, q.locale);
  const needle = q.q?.trim().toLowerCase();
  const rows = Object.keys(texts)
    .sort()
    .map((key) => ({ key, base: texts[key]!, english: ns.catalogs.en?.[key] ?? texts[key]!, value: own[key] ?? null }))
    .filter((r) => (!q.changed || r.value !== null) && (!needle || [r.key, r.base, r.value ?? ''].some((x) => x.toLowerCase().includes(needle))));
  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.min(Math.max(1, q.limit ?? 50), 200);
  return { object: 'list', namespace: ns.id, locale: q.locale, total: rows.length, changed: Object.keys(own).length, data: rows.slice(offset, offset + limit) };
}

/** Saves overrides (`null` or "" restores the built-in text). Placeholders must match the built-in text. */
export async function saveStrings(ctx: Ctx, ns: StringNamespace, locale: string, values: Record<string, string | null>) {
  if (!LOCALES.includes(locale as Locale)) throw invalid(t('strings.bad_locale'), [{ field: 'locale', code: 'invalid', message: t('strings.bad_locale') }]);
  const texts = base(ns, locale);
  const errors: FieldError[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!(key in texts)) errors.push({ field: `values.${key}`, code: 'unknown', message: t('strings.unknown_key') });
    else if (value !== null && value.length > 5000) errors.push({ field: `values.${key}`, code: 'too_long', message: t('strings.too_long') });
    else if (value) {
      const problem = shapeProblem(texts[key]!, value);
      if (problem) {
        const message = problem.plurals ? t('strings.plural_mismatch') : t('strings.placeholder_mismatch', { list: problem.params.map((p) => `{${p}}`).join(', ') || '—' });
        errors.push({ field: `values.${key}`, code: 'placeholders', message });
      }
    }
  }
  if (errors.length) throw invalid(t('strings.invalid'), errors);
  for (const [key, value] of Object.entries(values)) {
    if (value) await exec(ctx, `INSERT INTO string_overrides (tenant_id, namespace, locale, key, value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, namespace, locale, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [ctx.tenantId, ns.id, locale, key, value]);
    else await exec(ctx, `DELETE FROM string_overrides WHERE namespace = $1 AND locale = $2 AND key = $3`, [ns.id, locale, key]);
  }
  await audit(ctx, { entity_type: 'strings', entity_id: `${ns.id}:${locale}`, action: 'update', extra: { keys: Object.keys(values) } });
  return { object: 'strings', namespace: ns.id, locale, saved: Object.keys(values).length };
}

/** Built-in texts of a namespace in one language with the shop's overrides on top (plugin bundles). */
export async function mergedCatalog(ctx: Ctx, ns: StringNamespace | undefined, locale: string) {
  if (!ns) throw notFound('string_namespace', locale);
  return { ...base(ns, locale), ...(await overridesFor(ctx, ns.id, locale)) };
}
