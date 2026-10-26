import sanitizeHtml from 'sanitize-html';
import { isLocale } from '@openrent/i18n';
import type { Ctx } from '../context.ts';
import { invalid, type FieldError } from '../errors.ts';
import { audit } from '../events.ts';
import { t } from '../i18n/index.ts';
import { exec, json, must } from '../sql.ts';
import { resolveSettings } from '../tenancy/settings.ts';

/**
 * The shop's own CSS and header/footer HTML (FR-SF-4). Both are cleaned on save so the storefront can
 * render them as they are: no scripts, event handlers or inline styles in HTML, and nothing in CSS
 * that loads other files or runs code. The storefront CSP stays unchanged.
 */

export interface StorefrontCode {
  css: string;
  header_html: string;
  footer_html: string;
  /** Header and footer HTML in other storefront languages; empty falls back to the base HTML. */
  translations?: Record<string, { header_html?: string; footer_html?: string }>;
}

const MAX_CSS = 50_000;
const MAX_HTML = 20_000;

const HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
  allowedAttributes: {
    '*': ['class', 'id', 'role', 'aria-label', 'aria-hidden', 'title'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
  },
  allowedSchemes: ['https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // Links that open a new tab must not hand the shop's page to the target.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener noreferrer' } : attribs,
    }),
  },
};

export function cleanHtml(html: string): string {
  return sanitizeHtml(html ?? '', HTML_OPTIONS).trim();
}

const RICH_TEXT: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: HTML_OPTIONS.transformTags,
};

const looksLikeHtml = (v: string) => /<\/?[a-z][\s\S]*>/i.test(v);
const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Product descriptions (FR-CAT-1): rich text from the admin editor is cleaned to a small set of tags;
 * plain text (older products, imports) is kept as it is.
 */
export function cleanRichText(v: string | null | undefined): string {
  const text = v ?? '';
  return looksLikeHtml(text) ? sanitizeHtml(text, RICH_TEXT).trim() : text;
}

/** A stored description as safe HTML: plain text becomes paragraphs and line breaks. */
export function richTextHtml(v: string | null | undefined): string {
  const text = (v ?? '').trim();
  if (!text) return '';
  if (looksLikeHtml(text)) return sanitizeHtml(text, RICH_TEXT);
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** A stored description as plain text (cards, search results, meta descriptions). */
export function richTextPlain(v: string | null | undefined): string {
  const text = v ?? '';
  if (!looksLikeHtml(text)) return text;
  return sanitizeHtml(text.replace(/<\/(p|h[2-4]|li|blockquote)>|<br\s*\/?>/gi, '\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Drops what could end the style element, load other files or run code. */
export function cleanCss(css: string): string {
  return (css ?? '')
    .replace(/<\/?\s*style/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript\s*:/gi, '')
    .replace(/-moz-binding|behavior\s*:/gi, '')
    .trim();
}

export async function getStorefrontCode(ctx: Ctx): Promise<StorefrontCode> {
  const row = await must<{ settings: unknown }>(
    ctx,
    `SELECT settings FROM tenants WHERE id = $1`,
    [ctx.tenantId],
    'tenant',
  );
  return resolveSettings(row.settings).storefront_code;
}

/** Saves cleaned code. `warnings` lists the fields the cleaner changed, so staff can see what was removed. */
export async function saveStorefrontCode(ctx: Ctx, input: Partial<StorefrontCode>) {
  const errors: FieldError[] = [];
  if ((input.css ?? '').length > MAX_CSS)
    errors.push({ field: 'css', code: 'too_long', message: t('code.too_long', { max: MAX_CSS }) });
  for (const k of ['header_html', 'footer_html'] as const)
    if ((input[k] ?? '').length > MAX_HTML)
      errors.push({ field: k, code: 'too_long', message: t('code.too_long', { max: MAX_HTML }) });
  if (errors.length) throw invalid(t('code.invalid'), errors);
  const row = await must<{ settings: Record<string, any> | null }>(
    ctx,
    `SELECT settings FROM tenants WHERE id = $1 FOR UPDATE`,
    [ctx.tenantId],
    'tenant',
  );
  const settings = row.settings ?? {};
  const before = resolveSettings(settings).storefront_code;
  const next: StorefrontCode = { ...before };
  const warnings: FieldError[] = [];
  if (input.css !== undefined) next.css = cleanCss(input.css);
  if (input.header_html !== undefined) next.header_html = cleanHtml(input.header_html);
  if (input.footer_html !== undefined) next.footer_html = cleanHtml(input.footer_html);
  if (input.translations !== undefined) {
    const out: NonNullable<StorefrontCode['translations']> = {};
    for (const [locale, v] of Object.entries(input.translations ?? {})) {
      if (!isLocale(locale)) continue;
      for (const k of ['header_html', 'footer_html'] as const) {
        const raw = v?.[k] ?? '';
        if (raw.length > MAX_HTML) throw invalid(t('code.invalid'), [{ field: `translations.${locale}.${k}`, code: 'too_long', message: t('code.too_long', { max: MAX_HTML }) }]);
        const clean = cleanHtml(raw);
        if (clean) (out[locale] ??= {})[k] = clean;
        if (clean !== raw.trim()) warnings.push({ field: `translations.${locale}.${k}`, code: 'cleaned', message: t('code.html_cleaned') });
      }
    }
    next.translations = out;
  }
  for (const k of ['css', 'header_html', 'footer_html'] as const) {
    if (input[k] !== undefined && next[k] !== input[k]!.trim())
      warnings.push({
        field: k,
        code: 'cleaned',
        message: t(k === 'css' ? 'code.css_cleaned' : 'code.html_cleaned'),
      });
  }
  await exec(ctx, `UPDATE tenants SET settings = $2 WHERE id = $1`, [
    ctx.tenantId,
    json({ ...settings, storefront_code: next }),
  ]);
  await audit(ctx, {
    entity_type: 'tenant_settings',
    entity_id: ctx.tenantId,
    action: 'update_storefront_code',
    before: { storefront_code: before },
    after: { storefront_code: next },
  });
  return { object: 'storefront_code', ...next, warnings };
}
