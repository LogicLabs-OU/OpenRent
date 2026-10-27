import type { CheckoutField, LocalizedText } from '@openrent/plugin-sdk';
import { isPluginSection, type SectionSchema } from '@openrent/theme-sdk/manifest';
import { cleanHtml } from '../storefront/code.ts';
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

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;

/**
 * Scripts with their `{setting}` placeholders filled from the shop's plugin settings (plugin API 1.7).
 * A script whose `requires` setting is empty, or that does not end up as a plain https URL, is left out.
 */
function filledScripts(pluginId: string, scripts: NonNullable<ReturnType<Ctx['plugins']['storefrontExtensions']>[number]['ext']['scripts']>, config: Record<string, unknown>) {
  const value = (k: string) => (typeof config[k] === 'string' || typeof config[k] === 'number' ? String(config[k]).trim() : '');
  const fill = (s: string, enc: (v: string) => string) => s.replace(/\{([a-z0-9_]+)\}/gi, (_m, k: string) => enc(value(k)));
  return scripts.flatMap((s) => {
    if (s.requires && !value(s.requires)) return [];
    const src = fill(s.src, (v) => (s.src.startsWith(`{`) ? v : encodeURIComponent(v)));
    if (!HTTPS.test(src)) return [];
    const attrs = Object.fromEntries(
      Object.entries(s.attrs ?? {})
        .filter(([k]) => /^data-[a-z0-9-]{1,40}$/.test(k))
        .map(([k, v]): [string, string] => [k, fill(v, (x) => x).slice(0, 200)])
        .filter(([, v]) => /^[\w.:/@-]*$/.test(v)),
    );
    return [{ plugin: pluginId, src, consent: s.consent, attrs, connect: (s.connect ?? []).map((o) => fill(o, (x) => x).replace(/\/$/, '')).filter((o) => ORIGIN.test(o)) }];
  });
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
    scripts: (await Promise.all(list.map(async ({ pluginId, ext }) => (ext.scripts?.length ? filledScripts(pluginId, ext.scripts, (await pluginConfig(ctx, pluginId)).config) : [])))).flat(),
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

/**
 * Sections the storefront itself draws in every theme that takes plugin sections: the shop's locations
 * and a contact form. They use the `plugin:openrent:` names, which no plugin can take.
 */
export const BUILT_IN_SECTIONS = ['plugin:openrent:locations', 'plugin:openrent:contact'] as const;
function builtInSections(locale?: string | null): SectionSchema[] {
  const l = locale ?? undefined;
  return [
    {
      type: 'plugin:openrent:locations',
      name: msg('sections.locations.name', {}, l),
      settings: [
        { id: 'heading', type: 'text', label: msg('sections.field.heading', {}, l), default: msg('sections.locations.heading', {}, l) },
        { id: 'show_closures', type: 'checkbox', label: msg('sections.locations.show_closures', {}, l), default: true },
      ],
    },
    {
      type: 'plugin:openrent:contact',
      name: msg('sections.contact.name', {}, l),
      settings: [
        { id: 'heading', type: 'text', label: msg('sections.field.heading', {}, l), default: msg('sections.contact.heading', {}, l) },
        { id: 'text', type: 'textarea', label: msg('sections.field.text', {}, l), default: '' },
        { id: 'consent', type: 'text', label: msg('sections.contact.consent', {}, l), default: '' },
      ],
    },
  ] as SectionSchema[];
}

/** Section types for the home page and pages (FR-THM-12): the built-in ones, then plugins', named in `locale`. */
export async function pluginSectionSchemas(ctx: Ctx, locale?: string | null): Promise<SectionSchema[]> {
  const list = (await active(ctx)).filter((x) => x.pluginId !== 'openrent');
  return builtInSections(locale).concat(list.flatMap(({ pluginId, ext }) =>
    (ext.sections ?? [])
      .filter((s) => /^[a-z0-9-]{1,40}$/.test(s.type))
      .map((s) => ({ type: `plugin:${pluginId}:${s.type}`, name: pickText(s.name, locale) || s.type, settings: (s.settings ?? []) as SectionSchema['settings'] })),
  ));
}

/** A plugin section has this long to render before the page goes on without it. */
const RENDER_MS = 2000;

/**
 * HTML of the plugin sections in a home layout, by section id. Each is cleaned like the shop's own
 * HTML; one that fails or takes too long renders nothing, and the page still loads.
 */
export async function renderPluginSections(ctx: Ctx, layout: { id: string; type: string; settings?: Record<string, unknown> }[] | null | undefined, locale: string) {
  const out: Record<string, string> = {};
  const list = await active(ctx);
  for (const s of layout ?? []) {
    if (!isPluginSection(s.type)) continue;
    const [, pluginId, type] = s.type.split(':');
    const def = list.find((x) => x.pluginId === pluginId)?.ext.sections?.find((x) => x.type === type);
    if (!def) continue;
    const defaults = Object.fromEntries((def.settings ?? []).filter((f) => f.default !== undefined).map((f) => [f.id, f.default]));
    try {
      const { config } = await pluginConfig(ctx, pluginId!);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const html = await Promise.race([
        Promise.resolve(def.render({ tenantId: ctx.tenantId, config, logger: ctx.logger, locale }, { ...defaults, ...(s.settings ?? {}) })),
        new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timed out')), RENDER_MS))),
      ]).finally(() => clearTimeout(timer));
      out[s.id] = cleanHtml(String(html ?? ''));
    } catch (err) {
      ctx.logger.warn({ err, plugin: pluginId, section: s.type }, 'plugin section could not be rendered');
      out[s.id] = '';
    }
  }
  return out;
}
