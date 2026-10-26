import type { CheckoutField, LocalizedText } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { invalid, type FieldError } from '../errors.ts';
import { t as msg } from '../i18n/index.ts';
import { pluginConfig } from './index.ts';

/**
 * Plugins' storefront extensions for one shop (FR-PLG-5): checkout fields, product badges and scripts
 * that wait for consent. Only plugins the shop has on take part; texts come in the visitor's language.
 */
export const pickText = (text: LocalizedText | undefined, locale?: string | null) => (text ? (locale && text[locale]) || text.en || Object.values(text)[0] || '' : '');

const cache = new WeakMap<Ctx, Promise<{ pluginId: string; ext: ReturnType<Ctx['plugins']['storefrontExtensions']>[number]['ext'] }[]>>();

async function active(ctx: Ctx) {
  let p = cache.get(ctx);
  if (!p) {
    p = (async () => {
      const out = [];
      for (const e of ctx.plugins.storefrontExtensions()) if ((await pluginConfig(ctx, e.pluginId)).enabled) out.push(e);
      return out;
    })();
    cache.set(ctx, p);
  }
  return p;
}

/** Field key as the storefront and API use it: `<plugin id>.<key>`. */
const fieldKey = (pluginId: string, f: CheckoutField) => `${pluginId}.${f.key}`;
/** Where the value is kept on the order: a custom field only that plugin owns. */
export const storedKey = (pluginId: string, key: string) => `plg_${pluginId.replace(/-/g, '_')}_${key}`;

export async function storefrontExtensions(ctx: Ctx, locale?: string | null) {
  const list = await active(ctx);
  return {
    checkout_fields: list.flatMap(({ pluginId, ext }) =>
      (ext.checkoutFields ?? []).map((f) => ({
        key: fieldKey(pluginId, f),
        type: f.type,
        required: !!f.required,
        label: pickText(f.label, locale),
        help: pickText(f.help, locale) || null,
        options: (f.options ?? []).map((o) => ({ value: o.value, label: pickText(o.label, locale) })),
      })),
    ),
    // Only https scripts; each is listed in the page's CSP once the visitor allows its category.
    scripts: list.flatMap(({ pluginId, ext }) => (ext.scripts ?? []).filter((s) => /^https:\/\/[^\s"']+$/.test(s.src)).map((s) => ({ plugin: pluginId, src: s.src, consent: s.consent }))),
  };
}

export async function productBadges(ctx: Ctx, tags: string[] | null | undefined, locale?: string | null) {
  if (!tags?.length) return [];
  const list = await active(ctx);
  return list.flatMap(({ ext }) => (ext.productBadges ?? []).filter((b) => tags.includes(b.tag)).map((b) => ({ label: pickText(b.label, locale), tone: b.tone ?? 'default' })));
}

/** Checks the checkout's extra values; returns what to store on the order (custom fields). */
export async function checkCheckoutExtra(ctx: Ctx, extra: Record<string, unknown> | undefined) {
  const list = await active(ctx);
  const errors: FieldError[] = [];
  const stored: Record<string, unknown> = {};
  for (const { pluginId, ext } of list) {
    for (const f of ext.checkoutFields ?? []) {
      const key = fieldKey(pluginId, f);
      const v = extra?.[key];
      const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && v !== true);
      if (empty) {
        if (f.required) errors.push({ field: `extra.${key}`, code: 'required', message: msg('checkout.extra_required') });
        continue;
      }
      if ((f.type === 'text' && (typeof v !== 'string' || v.length > 500)) || (f.type === 'select' && !(f.options ?? []).some((o) => o.value === v))) {
        errors.push({ field: `extra.${key}`, code: 'invalid', message: msg('checkout.extra_invalid') });
        continue;
      }
      stored[storedKey(pluginId, f.key)] = v;
    }
  }
  if (errors.length) throw invalid(msg('checkout.extra_invalid'), errors);
  return stored;
}
