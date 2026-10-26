import { createHmac, timingSafeEqual } from 'node:crypto';
import { contentField, resolveSettings as themeDefaults, validateSections, validateThemeSettings, type SectionInstance, type ThemeMeta } from '@openrent/theme-sdk/manifest';
import { isLocale } from '@openrent/i18n';
import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit } from '../events.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { exec, json, must } from '../sql.ts';
import { resolveSettings, type TenantSettings } from '../tenancy/settings.ts';

/** An installed theme as the API sees it: its JSON parts plus install-time problems. */
export interface InstalledTheme extends ThemeMeta {
  package: string;
  problems: string[];
  /** Child themes (theme API 1.4): the code theme they build on, their CSS and asset file ids. */
  parent?: string;
  css?: string;
  assets?: Record<string, string>;
}

async function settingsForUpdate(ctx: Ctx): Promise<Record<string, any>> {
  const row = await must<{ settings: Record<string, any> | null }>(ctx, `SELECT settings FROM tenants WHERE id = $1 FOR UPDATE`, [ctx.tenantId], 'tenant');
  return row.settings ?? {};
}

async function saveSettings(ctx: Ctx, settings: Record<string, any>) {
  await exec(ctx, `UPDATE tenants SET settings = $2 WHERE id = $1`, [ctx.tenantId, json(settings)]);
}

async function current(ctx: Ctx): Promise<TenantSettings> {
  const row = await must<{ settings: unknown }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  return resolveSettings(row.settings);
}

/** Saved settings of one theme. The live theme may still use the older `theme.settings` store. */
export function savedThemeSettings(s: TenantSettings, id: string): Record<string, unknown> {
  return s.theme_settings[id] ?? (s.theme.id === id ? s.theme.settings : {});
}

function find(installed: InstalledTheme[], id: string): InstalledTheme {
  const theme = installed.find((x) => x.manifest.id === id);
  if (!theme) throw new AppError('not_found', 404, t('themes.not_installed', { id }));
  return theme;
}

function summary(theme: InstalledTheme, s: TenantSettings) {
  const m = theme.manifest;
  return {
    id: m.id,
    object: 'theme',
    name: m.name,
    version: m.version,
    author: m.author,
    license: m.license,
    compat: m.compat,
    locales: m.locales,
    sections: m.sections ?? [],
    preview_images: m.preview_images ?? [],
    package: theme.package,
    extends: theme.parent ?? null,
    live: s.theme.id === m.id,
    status: theme.problems.length ? 'incompatible' : 'ok',
    problems: theme.problems,
  };
}

export async function listThemes(ctx: Ctx, installed: InstalledTheme[]) {
  const s = await current(ctx);
  return installed.map((theme) => summary(theme, s));
}

export async function getTheme(ctx: Ctx, installed: InstalledTheme[], id: string) {
  const theme = find(installed, id);
  const s = await current(ctx);
  const saved = savedThemeSettings(s, id);
  return {
    ...summary(theme, s),
    settings_schema: theme.settingsSchema,
    defaults: themeDefaults(theme),
    settings: saved,
    translations: s.theme_translations[id] ?? {},
    strings: theme.locales,
    section_schemas: theme.sectionSchemas ?? [],
    /** The shop's layout, or null while it uses the theme's default (`sections_default`). */
    sections: (s.theme_sections[id] as SectionInstance[] | undefined) ?? null,
    sections_default: theme.sectionsData ?? [],
    /** Shop texts per storefront language (locale → overlay path → text). */
    content_translations: s.theme_content_translations[id] ?? {},
  };
}

/**
 * Saves shop texts of a theme in one storefront language: theme settings and home page section
 * texts. Keys are overlay paths (`settings.footer_heading`, `sections.hero.heading`,
 * `sections.faq.blocks.q1.answer`); null or "" removes a translation.
 */
export async function updateThemeContent(ctx: Ctx, installed: InstalledTheme[], id: string, locale: string, values: Record<string, string | null>) {
  const theme = find(installed, id);
  if (!isLocale(locale)) throw invalid(t('themes.invalid_locale'), [{ field: 'locale', code: 'invalid', message: t('themes.invalid_locale') }]);
  const raw = await settingsForUpdate(ctx);
  const s = resolveSettings(raw);
  const layout = ((s.theme_sections[id] as SectionInstance[] | undefined) ?? theme.sectionsData ?? []) as SectionInstance[];
  const errors: FieldError[] = Object.keys(values)
    .filter((path) => !contentField(theme, layout, path))
    .map((path) => ({ field: `values.${path}`, code: 'unknown', message: t('themes.unknown_content') }));
  if (errors.length) throw invalid(t('themes.invalid_content'), errors);
  const all = { ...(raw.theme_content_translations ?? {}) };
  const forTheme = { ...(all[id] ?? {}) };
  const next: Record<string, string> = { ...(forTheme[locale] ?? {}) };
  for (const [path, v] of Object.entries(values)) {
    if (v === null || !String(v).trim()) delete next[path];
    else next[path] = String(v).slice(0, 5000);
  }
  forTheme[locale] = next;
  all[id] = forTheme;
  raw.theme_content_translations = all;
  await saveSettings(ctx, raw);
  await audit(ctx, { entity_type: 'theme', entity_id: id, action: 'update_content', extra: { locale, keys: Object.keys(values) } });
  return getTheme(ctx, installed, id);
}

/** Saves the home layout (theme API 1.3). `null` goes back to the theme's default layout. */
export async function updateThemeSections(ctx: Ctx, installed: InstalledTheme[], id: string, layout: unknown[] | null) {
  const theme = find(installed, id);
  const raw = await settingsForUpdate(ctx);
  const all = { ...(raw.theme_sections ?? {}) };
  if (layout === null) delete all[id];
  else {
    const { sections, problems } = validateSections(theme, layout);
    if (problems.length) {
      throw invalid(
        t('themes.invalid_sections'),
        problems.map((p) => ({ field: p.path, code: p.code, message: t(`themes.problem.${p.code}` as MessageKey, p.params ?? {}) })),
      );
    }
    all[id] = sections;
  }
  raw.theme_sections = all;
  await saveSettings(ctx, raw);
  await audit(ctx, { entity_type: 'theme', entity_id: id, action: 'update_sections', extra: { sections: layout?.length ?? null } });
  return getTheme(ctx, installed, id);
}

function settingErrors(problems: ReturnType<typeof validateThemeSettings>['problems']): FieldError[] {
  return problems.map((p) => ({ field: `settings.${p.id}`, code: p.code, message: t(`themes.problem.${p.code}` as MessageKey, p.params ?? {}) }));
}

/** Saves theme settings. `null` resets a value to the theme default; `replace` drops values not sent. */
export async function updateThemeSettings(ctx: Ctx, installed: InstalledTheme[], id: string, values: Record<string, unknown>, opts: { replace?: boolean } = {}) {
  const theme = find(installed, id);
  const { values: clean, problems } = validateThemeSettings(theme, values);
  if (problems.length) throw invalid(t('themes.invalid_settings'), settingErrors(problems));
  const raw = await settingsForUpdate(ctx);
  const s = resolveSettings(raw);
  const next: Record<string, unknown> = opts.replace ? {} : { ...savedThemeSettings(s, id) };
  for (const [k, v] of Object.entries(values)) if (v === null) delete next[k];
  Object.assign(next, clean);
  raw.theme_settings = { ...(raw.theme_settings ?? {}), [id]: next };
  await saveSettings(ctx, raw);
  await audit(ctx, { entity_type: 'theme', entity_id: id, action: 'update_settings', extra: { keys: Object.keys(values) } });
  return getTheme(ctx, installed, id);
}

/** Makes an installed, compatible theme live on the storefront (FR-THM-3). */
export async function publishTheme(ctx: Ctx, installed: InstalledTheme[], id: string) {
  const theme = find(installed, id);
  if (theme.problems.length) throw new AppError('theme_incompatible', 409, t('themes.incompatible', { id }), { extra: { problems: theme.problems } });
  const raw = await settingsForUpdate(ctx);
  const s = resolveSettings(raw);
  const previous = s.theme.id;
  // Keep the outgoing theme's legacy settings under theme_settings before switching.
  raw.theme_settings = { ...(raw.theme_settings ?? {}), [previous]: savedThemeSettings(s, previous) };
  raw.theme = { id, settings: {} };
  await saveSettings(ctx, raw);
  await audit(ctx, { entity_type: 'theme', entity_id: id, action: 'publish', extra: { previous } });
  return getTheme(ctx, installed, id);
}

/** Tenant overrides of theme strings for one locale (FR-THM-6). `null` or "" removes an override. */
export async function updateThemeTranslations(ctx: Ctx, installed: InstalledTheme[], id: string, locale: string, strings: Record<string, string | null>) {
  const theme = find(installed, id);
  const known = new Set(Object.keys(theme.locales.en ?? {}));
  const errors: FieldError[] = Object.keys(strings)
    .filter((k) => !known.has(k))
    .map((k) => ({ field: `strings.${k}`, code: 'unknown', message: t('themes.unknown_string') }));
  if (errors.length) throw invalid(t('themes.invalid_translations'), errors);
  const raw = await settingsForUpdate(ctx);
  const all = { ...(raw.theme_translations ?? {}) };
  const forTheme = { ...(all[id] ?? {}) };
  const next = { ...(forTheme[locale] ?? {}) };
  for (const [k, v] of Object.entries(strings)) {
    if (v === null || v === '') delete next[k];
    else next[k] = v;
  }
  forTheme[locale] = next;
  all[id] = forTheme;
  raw.theme_translations = all;
  await saveSettings(ctx, raw);
  await audit(ctx, { entity_type: 'theme', entity_id: id, action: 'update_translations', extra: { locale, keys: Object.keys(strings) } });
  return getTheme(ctx, installed, id);
}

/** Portable settings file (FR-THM-4): moves a customisation between shops or installations. */
export async function exportThemeSettings(ctx: Ctx, installed: InstalledTheme[], id: string) {
  const theme = find(installed, id);
  const s = await current(ctx);
  return { object: 'theme_settings_export', theme: id, theme_version: theme.manifest.version, exported_at: ctx.now.toISOString(), settings: savedThemeSettings(s, id), translations: s.theme_translations[id] ?? {}, sections: s.theme_sections[id] ?? null };
}

export async function importThemeSettings(ctx: Ctx, installed: InstalledTheme[], id: string, body: { theme?: string; settings: Record<string, unknown>; translations?: Record<string, Record<string, string>>; sections?: unknown[] | null }) {
  if (body.theme && body.theme !== id) throw invalid(t('themes.import_wrong_theme', { expected: id, actual: body.theme }), [{ field: 'theme', code: 'mismatch', message: t('themes.import_wrong_theme', { expected: id, actual: body.theme }) }]);
  await updateThemeSettings(ctx, installed, id, body.settings ?? {}, { replace: true });
  for (const [locale, strings] of Object.entries(body.translations ?? {})) await updateThemeTranslations(ctx, installed, id, locale, strings);
  if (body.sections !== undefined) await updateThemeSections(ctx, installed, id, body.sections);
  return getTheme(ctx, installed, id);
}

// ---------------------------------------------------------------------------
// Preview links (FR-THM-3): a signed, expiring token naming tenant and theme.
// ---------------------------------------------------------------------------

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function previewToken(secret: string, tenantId: string, themeId: string, expiresAt: Date): string {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, th: themeId, e: Math.floor(expiresAt.getTime() / 1000) })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyPreviewToken(secret: string, token: string, now = new Date()): { tenantId: string; themeId: string } | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { t: string; th: string; e: number };
    if (!p.t || !p.th || p.e * 1000 < now.getTime()) return null;
    return { tenantId: p.t, themeId: p.th };
  } catch {
    return null;
  }
}

/** What the storefront renders: the live theme, or the previewed one, with saved settings and string overrides. */
export function storefrontTheme(s: TenantSettings, previewThemeId?: string | null, locale?: string | null) {
  const id = previewThemeId ?? s.theme.id;
  return {
    id,
    settings: savedThemeSettings(s, id),
    translations: s.theme_translations[id] ?? {},
    sections: s.theme_sections[id] ?? null,
    /** Shop texts in the requested language, applied over settings and sections by the storefront. */
    content: (locale && s.theme_content_translations[id]?.[locale]) || {},
    preview: !!previewThemeId,
  };
}
export * from './child.ts';
