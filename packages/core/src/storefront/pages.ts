import { contentField, validateSections, type SectionInstance } from '@openrent/theme-sdk/manifest';
import { isLocale } from '@openrent/i18n';
import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { newId } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { slugify } from '../tenancy/index.ts';
import { findTheme, storefrontTheme, withPlugins, type InstalledTheme } from '../themes/index.ts';
import { resolveSettings } from '../tenancy/settings.ts';
import { renderPluginSections } from '../plugins/storefront.ts';
import { cleanRichText, richTextHtml } from './code.ts';

/** The shop's own storefront pages (about, contact, FAQ), at `/pages/<slug>`. `terms` is the rental terms. */
export const RESERVED_PAGE_SLUGS = ['terms'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PageTexts = { title?: string | null; body?: string | null; seo_title?: string | null; seo_description?: string | null };
export interface PageInput {
  title?: string;
  slug?: string;
  status?: 'draft' | 'published';
  body?: string;
  seo?: { title?: string | null; description?: string | null };
  translations?: Record<string, PageTexts>;
}

export function pageToApi(r: any) {
  return {
    id: r.id, object: 'storefront_page', slug: r.slug, status: r.status, title: r.title, body: r.body, seo: r.seo ?? {}, translations: r.translations ?? {},
    sections: r.sections ?? {}, content_translations: r.content_translations ?? {}, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export async function listPages(ctx: Ctx) {
  return { object: 'list', data: (await many(ctx, `SELECT * FROM storefront_pages WHERE deleted_at IS NULL ORDER BY title, slug`)).map(pageToApi) };
}

const load = (ctx: Ctx, id: string, lock = false) => must<any>(ctx, `SELECT * FROM storefront_pages WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id], 'storefront_page', id);

export async function getPage(ctx: Ctx, id: string) {
  return pageToApi(await load(ctx, id));
}

/** Field by field: a page needs a title; its address is short, lowercase and not taken; texts fit search results. */
async function check(ctx: Ctx, input: PageInput, id: string | null) {
  const errors: FieldError[] = [];
  const text = (field: string, v: unknown, max: number) => {
    if (v == null) return;
    if (typeof v !== 'string') errors.push({ field, code: 'invalid', message: t('settings.invalid') });
    else if (v.length > max) errors.push({ field, code: 'too_long', message: t('settings.seo_too_long', { max }) });
  };
  if (input.title !== undefined && !input.title.trim()) errors.push({ field: 'title', code: 'required', message: t('pages.title_required') });
  text('title', input.title, 120);
  if (input.slug !== undefined) {
    if (!SLUG.test(input.slug) || input.slug.length > 80) errors.push({ field: 'slug', code: 'invalid', message: t('pages.slug_invalid') });
    else if (RESERVED_PAGE_SLUGS.includes(input.slug)) errors.push({ field: 'slug', code: 'reserved', message: t('pages.slug_reserved', { slug: input.slug }) });
    else if (await one(ctx, `SELECT 1 FROM storefront_pages WHERE slug = $1 AND deleted_at IS NULL AND id IS DISTINCT FROM $2`, [input.slug, id])) errors.push({ field: 'slug', code: 'taken', message: t('pages.slug_taken') });
  }
  if (input.status !== undefined && !['draft', 'published'].includes(input.status)) errors.push({ field: 'status', code: 'invalid', message: t('settings.invalid') });
  text('seo.title', input.seo?.title, 70);
  text('seo.description', input.seo?.description, 160);
  for (const [l, v] of Object.entries(input.translations ?? {})) {
    if (!isLocale(l)) errors.push({ field: `translations.${l}`, code: 'invalid', message: t('settings.invalid_locales') });
    text(`translations.${l}.title`, v?.title, 120);
    text(`translations.${l}.seo_title`, v?.seo_title, 70);
    text(`translations.${l}.seo_description`, v?.seo_description, 160);
  }
  if (errors.length) throw invalid(t('pages.invalid'), errors);
}

/** Texts in other languages: empty ones are dropped, so the page shows the default language's. */
function cleanTranslations(tr: Record<string, PageTexts> | undefined) {
  return Object.fromEntries(
    Object.entries(tr ?? {})
      .map(([l, v]) => [l, Object.fromEntries(Object.entries({ ...v, body: v?.body == null ? v?.body : cleanRichText(v.body) }).filter(([, x]) => typeof x === 'string' && x.trim()))])
      .filter(([, v]) => Object.keys(v as object).length),
  );
}

const cleanSeo = (seo: PageInput['seo']) => Object.fromEntries(Object.entries(seo ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()));

export async function createPage(ctx: Ctx, input: PageInput) {
  const slug = input.slug ?? slugify(input.title ?? '');
  await check(ctx, { ...input, title: input.title ?? '', slug }, null);
  const id = newId('pag');
  const [row] = await many(
    ctx,
    `INSERT INTO storefront_pages (id, tenant_id, slug, status, title, body, seo, translations) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, ctx.tenantId, slug, input.status ?? 'draft', input.title!.trim(), cleanRichText(input.body ?? ''), json(cleanSeo(input.seo)), json(cleanTranslations(input.translations))],
  );
  const api = pageToApi(row);
  await audit(ctx, { entity_type: 'storefront_page', entity_id: id, action: 'create', after: row });
  await emit(ctx, 'storefront_page.created', { type: 'storefront_page', id }, api);
  return api;
}

export async function updatePage(ctx: Ctx, id: string, input: PageInput) {
  const before = await load(ctx, id, true);
  await check(ctx, input, id);
  const [row] = await many(
    ctx,
    `UPDATE storefront_pages SET slug = $2, status = $3, title = $4, body = $5, seo = $6, translations = $7 WHERE id = $1 RETURNING *`,
    [
      id,
      input.slug ?? before.slug,
      input.status ?? before.status,
      input.title?.trim() ?? before.title,
      input.body === undefined ? before.body : cleanRichText(input.body),
      json(input.seo === undefined ? before.seo : cleanSeo(input.seo)),
      json(input.translations === undefined ? before.translations : cleanTranslations(input.translations)),
    ],
  );
  const api = pageToApi(row);
  await audit(ctx, { entity_type: 'storefront_page', entity_id: id, action: 'update', before, after: row });
  await emit(ctx, 'storefront_page.updated', { type: 'storefront_page', id }, api);
  return api;
}

export async function deletePage(ctx: Ctx, id: string) {
  const before = await load(ctx, id, true);
  await exec(ctx, `UPDATE storefront_pages SET deleted_at = now() WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'storefront_page', entity_id: id, action: 'delete', before });
  await emit(ctx, 'storefront_page.deleted', { type: 'storefront_page', id }, { id, object: 'storefront_page', deleted: true });
  return { id, object: 'storefront_page', deleted: true };
}

/** A page's sections for one theme, checked like the home page's; `null` removes them. */
export async function updatePageSections(ctx: Ctx, installed: InstalledTheme[], id: string, themeId: string, layout: unknown[] | null) {
  const theme = await withPlugins(ctx, findTheme(installed, themeId));
  const before = await load(ctx, id, true);
  const all = { ...(before.sections ?? {}) };
  if (layout === null) delete all[themeId];
  else {
    const { sections, problems } = validateSections(theme, layout);
    if (problems.length) throw invalid(t('themes.invalid_sections'), problems.map((p) => ({ field: p.path, code: p.code, message: t(`themes.problem.${p.code}` as MessageKey, p.params ?? {}) })));
    all[themeId] = sections;
  }
  const [row] = await many(ctx, `UPDATE storefront_pages SET sections = $2 WHERE id = $1 RETURNING *`, [id, json(all)]);
  const api = pageToApi(row);
  await audit(ctx, { entity_type: 'storefront_page', entity_id: id, action: 'update_sections', extra: { theme: themeId, sections: layout?.length ?? null } });
  await emit(ctx, 'storefront_page.updated', { type: 'storefront_page', id }, api);
  return api;
}

/** Section texts of a page in one language and theme (overlay paths as for the home page); null or "" removes one. */
export async function updatePageContent(ctx: Ctx, installed: InstalledTheme[], id: string, themeId: string, locale: string, values: Record<string, string | null>) {
  const theme = findTheme(installed, themeId);
  if (!isLocale(locale)) throw invalid(t('themes.invalid_locale'), [{ field: 'locale', code: 'invalid', message: t('themes.invalid_locale') }]);
  const before = await load(ctx, id, true);
  const layout = (before.sections?.[themeId] ?? []) as SectionInstance[];
  const errors: FieldError[] = Object.keys(values).filter((path) => !path.startsWith('sections.') || !contentField(theme, layout, path)).map((path) => ({ field: `values.${path}`, code: 'unknown', message: t('themes.unknown_content') }));
  if (errors.length) throw invalid(t('themes.invalid_content'), errors);
  const all = { ...(before.content_translations ?? {}) };
  const forTheme = { ...(all[themeId] ?? {}) };
  const next: Record<string, string> = { ...(forTheme[locale] ?? {}) };
  for (const [path, v] of Object.entries(values)) {
    if (v === null || !String(v).trim()) delete next[path];
    else next[path] = String(v).slice(0, 5000);
  }
  forTheme[locale] = next;
  all[themeId] = forTheme;
  const [row] = await many(ctx, `UPDATE storefront_pages SET content_translations = $2 WHERE id = $1 RETURNING *`, [id, json(all)]);
  await audit(ctx, { entity_type: 'storefront_page', entity_id: id, action: 'update_content', extra: { theme: themeId, locale, keys: Object.keys(values) } });
  return pageToApi(row);
}

/**
 * A published page for the storefront in one language (drafts too in a theme preview): its text as
 * safe HTML, and its sections for the theme shown with their texts in that language.
 */
export async function publicPage(ctx: Ctx, slug: string, opts: { themeId: string; locale?: string | null; preview?: boolean }) {
  const r = await one<any>(ctx, `SELECT * FROM storefront_pages WHERE slug = $1 AND deleted_at IS NULL AND (status = 'published' OR $2)`, [slug, !!opts.preview]);
  if (!r) throw new AppError('not_found', 404, t('pages.not_found'));
  const tenant = await must<{ locale: string }>(ctx, `SELECT locale FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const own: PageTexts = (opts.locale && r.translations?.[opts.locale]) || {};
  const sections = (r.sections?.[opts.themeId] ?? []) as SectionInstance[];
  return {
    object: 'storefront_page',
    slug: r.slug,
    status: r.status,
    title: own.title?.trim() || r.title,
    body_html: richTextHtml(own.body?.trim() ? own.body : r.body),
    seo: { title: own.seo_title?.trim() || r.seo?.title || null, description: own.seo_description?.trim() || r.seo?.description || null },
    sections,
    content: (opts.locale && r.content_translations?.[opts.themeId]?.[opts.locale]) || {},
    plugin_sections: await renderPluginSections(ctx, sections, opts.locale ?? tenant.locale),
    updated_at: r.updated_at,
  };
}

/** A page as the storefront shows it: with the live theme's sections, or a previewed theme's (drafts too). */
export async function storefrontPage(ctx: Ctx, slug: string, opts: { previewThemeId?: string | null; locale?: string | null }) {
  const row = await must<{ settings: unknown }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const theme = storefrontTheme(resolveSettings(row.settings), opts.previewThemeId);
  return publicPage(ctx, slug, { themeId: theme.id, locale: opts.locale, preview: !!opts.previewThemeId });
}

/** Published pages by slug and title in one language, for menus and the sitemap. */
export async function publishedPages(ctx: Ctx, locale?: string | null) {
  const rows = await many<any>(ctx, `SELECT id, slug, title, translations, updated_at FROM storefront_pages WHERE deleted_at IS NULL AND status = 'published' ORDER BY slug`);
  return rows.map((r) => ({ id: r.id as string, slug: r.slug as string, title: ((locale && r.translations?.[locale]?.title?.trim()) || r.title) as string, updated_at: r.updated_at as string }));
}
