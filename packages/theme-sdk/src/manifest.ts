import { format } from '@openrent/i18n';
import type { TemplateName } from './types.ts';

export const THEME_API_VERSION = '1.9.0';
export const REQUIRED_TEMPLATES: TemplateName[] = ['index', 'collection', 'product', 'cart', 'checkout', 'order-confirmation', 'page', '404'];
/** Templates a theme may leave out; the storefront then uses the default theme's (theme API 1.3). */
export const OPTIONAL_TEMPLATES: TemplateName[] = ['account', 'account-login', 'search', 'sign'];

export type SettingType = 'color' | 'font' | 'image' | 'text' | 'textarea' | 'select' | 'range' | 'checkbox' | 'link' | 'product' | 'collection';

export interface SettingSchema {
  id: string;
  type: SettingType;
  label: string;
  default?: unknown;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  info?: string;
}

/** theme.json (FR-THM-1). */
export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  /** Semver range of the theme API, e.g. "^1.0.0". */
  compat: string;
  locales: string[];
  preview_images?: string[];
  sections?: string[];
  /**
   * A child theme (theme API 1.4) names an installed code theme it builds on and brings only data:
   * default settings, home layout, texts, CSS and assets. Shops install it at runtime.
   */
  extends?: string;
  /**
   * Places plugins may fill (theme API 1.8, FR-THM-12): `section.register` offers plugins' section
   * types in the section editor (the theme renders them with the `section.plugin` slot);
   * `checkout.extra_fields` shows plugins' checkout fields.
   */
  extension_points?: string[];
}

export const EXTENSION_POINTS = ['section.register', 'checkout.extra_fields'] as const;
export type ExtensionPoint = (typeof EXTENSION_POINTS)[number];

/** Section types plugins add carry this prefix: `plugin:<plugin id>:<type>`. */
export const isPluginSection = (type: string) => type.startsWith('plugin:');

/** The theme's own section types plus plugins' ones, when the theme takes them. */
export function withPluginSections<T extends ThemeMeta>(t: T, plugin: SectionSchema[]): T {
  if (!plugin.length || !t.manifest.extension_points?.includes('section.register')) return t;
  return { ...t, sectionSchemas: [...(t.sectionSchemas ?? []), ...plugin] };
}

/** A home page section type, from `sections/<type>.json` (theme API 1.3). */
export interface SectionSchema {
  type: string;
  name: string;
  settings: SettingSchema[];
  /** Repeatable items inside the section (FAQ entries, feature cards). */
  blocks?: { type: string; name: string; settings: SettingSchema[] }[];
  max_blocks?: number;
}

export interface SectionBlock {
  id: string;
  type: string;
  settings: Record<string, unknown>;
}

/** One section on the home page, in the order the shop arranged them. */
export interface SectionInstance {
  id: string;
  type: string;
  settings: Record<string, unknown>;
  blocks: SectionBlock[];
}

/** The data parts of a theme (no components). The API reads these from the package's JSON files. */
export interface ThemeMeta {
  manifest: ThemeManifest;
  settingsSchema: { name: string; settings: SettingSchema[] }[];
  settingsData: Record<string, unknown>;
  locales: Record<string, Record<string, string>>;
  /** Section types (`sections/*.json`) and the default home layout (`config/sections_data.json`). */
  sectionSchemas?: SectionSchema[];
  sectionsData?: SectionInstance[];
  /** `widget/widget.css` (theme API 1.8): the embeddable widget's look, with `{{ … }}` placeholders. */
  widgetCss?: string;
}

export interface ThemeModule extends ThemeMeta {
  layout: any;
  templates: Partial<Record<TemplateName, any>>;
}

/** Caret/tilde/exact range check without dependencies (themes only use these forms). */
export function satisfies(version: string, range: string): boolean {
  const parse = (v: string) => v.replace(/^[^\d]*/, '').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const [a, b, c] = parse(version);
  const r = range.trim();
  const [x, y, z] = parse(r);
  if (r.startsWith('^')) return a === x && (b! > y! || (b === y && c! >= z!)) && (x !== 0 || b === y);
  if (r.startsWith('~')) return a === x && b === y && c! >= z!;
  if (r.startsWith('>=')) return a! > x! || (a === x && (b! > y! || (b === y && c! >= z!)));
  return a === x && b === y && c === z;
}

/** Manifest, locale and settings-schema checks shared by the API (install) and the storefront (load). */
export function validateThemeMeta(t: ThemeMeta): string[] {
  const errors: string[] = [];
  const m = t.manifest;
  for (const k of ['id', 'name', 'version', 'author', 'license', 'compat'] as const) if (!m?.[k]) errors.push(`theme.json: missing "${k}"`);
  if (m?.id && !/^[a-z0-9-]+$/.test(m.id)) errors.push('theme.json: id must be lowercase letters, digits and dashes');
  if (m?.compat && !satisfies(THEME_API_VERSION, m.compat)) errors.push(`theme requires theme API ${m.compat}; this storefront provides ${THEME_API_VERSION}`);
  if (!t.locales?.en) errors.push('missing locales/en.json');
  for (const p of m?.extension_points ?? []) if (!(EXTENSION_POINTS as readonly string[]).includes(p)) errors.push(`theme.json: unknown extension point "${p}"`);
  const ids = new Set<string>();
  for (const group of t.settingsSchema ?? []) for (const s of group.settings) {
    if (ids.has(s.id)) errors.push(`settings_schema.json: duplicate setting id "${s.id}"`);
    ids.add(s.id);
    if (s.type === 'select' && !s.options?.length) errors.push(`settings_schema.json: select "${s.id}" has no options`);
  }
  const types = new Set<string>();
  for (const sec of t.sectionSchemas ?? []) {
    if (types.has(sec.type)) errors.push(`sections/${sec.type}.json: duplicate section type`);
    types.add(sec.type);
  }
  if (t.sectionsData) for (const p of validateSections(t, t.sectionsData).problems) errors.push(`config/sections_data.json: ${p.path} ${p.code}`);
  return errors;
}

/** Files a child theme may contain; anything else (code) needs an operator install and a build. */
export const CHILD_THEME_FILE = /^(theme\.json|theme\.css|config\/(settings_data|sections_data)\.json|locales\/[a-z]{2}\.json|assets\/[A-Za-z0-9._/-]+\.(png|jpe?g|webp|gif|svg|avif|woff2?|ttf|otf|css)|README\.md|LICENSE(\.md)?)$/;

/**
 * Imports a theme's code may use (FR-THM-7): Svelte, the theme SDK, the shared UI kit and the packages
 * its components hand to themes (toasts, date values, component types), icons and its own files.
 * Anything else (Node, the server, SvelteKit internals) would break theme portability.
 */
const ALLOWED_IMPORT = /^(svelte(\/[\w-]+)*|@openrent\/theme-sdk(\/[\w.-]+)?|@openrent\/ui(\/[\w-]+)*|@lucide\/svelte(\/[\w-]+)*|svelte-sonner|bits-ui|@internationalized\/date|\.{1,2}\/[^'"]*)$/;

/** Problems in one source file of a code theme: forbidden imports and direct network calls. */
export function checkThemeSource(file: string, code: string): string[] {
  const problems: string[] = [];
  for (const m of code.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1] ?? m[2] ?? m[3]!;
    if (!ALLOWED_IMPORT.test(spec)) problems.push(`${file}: imports "${spec}"; themes may import only svelte, @openrent/theme-sdk, @openrent/ui and its companions, @lucide/svelte and their own files`);
  }
  if (/\bfetch\s*\(|XMLHttpRequest|\bWebSocket\s*\(/.test(code)) problems.push(`${file}: calls the network directly; use the runtime (getRuntime()) instead`);
  return problems;
}

/** FR-THM-8: refuses themes outside the compat range and lists every problem. */
export function validateTheme(t: ThemeModule): string[] {
  const errors = validateThemeMeta(t);
  for (const name of REQUIRED_TEMPLATES) if (!t.templates[name]) errors.push(`missing template templates/${name}.svelte`);
  if (!t.layout) errors.push('missing layouts/theme.svelte');
  return errors;
}

export interface SettingProblem {
  id: string;
  code: 'unknown' | 'invalid_color' | 'not_text' | 'not_number' | 'out_of_range' | 'not_boolean' | 'not_in_options' | 'invalid_link';
  params?: Record<string, string | number>;
}

/**
 * Checks tenant values against settings_schema.json (FR-THM-4). Returns normalised values and the
 * problems found; `null` clears a value back to the theme default.
 */
export function validateThemeSettings(t: ThemeMeta, values: Record<string, unknown>): { values: Record<string, unknown>; problems: SettingProblem[] } {
  return checkValues(t.settingsSchema.flatMap((g) => g.settings), values);
}

/** Checks values against a list of setting definitions (theme settings, sections and blocks). */
export function checkValues(schema: SettingSchema[], values: Record<string, unknown>): { values: Record<string, unknown>; problems: SettingProblem[] } {
  const fields = new Map(schema.map((s) => [s.id, s]));
  const out: Record<string, unknown> = {};
  const problems: SettingProblem[] = [];
  for (const [id, v] of Object.entries(values)) {
    const f = fields.get(id);
    if (!f) {
      problems.push({ id, code: 'unknown' });
      continue;
    }
    if (v === null) continue;
    switch (f.type) {
      case 'color':
        if (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) out[id] = v.toLowerCase();
        else problems.push({ id, code: 'invalid_color' });
        break;
      case 'range': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) problems.push({ id, code: 'not_number' });
        else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) problems.push({ id, code: 'out_of_range', params: { min: f.min ?? '', max: f.max ?? '' } });
        else out[id] = n;
        break;
      }
      case 'checkbox':
        if (typeof v === 'boolean') out[id] = v;
        else problems.push({ id, code: 'not_boolean' });
        break;
      case 'select':
        if (f.options?.some((o) => o.value === v)) out[id] = v;
        else problems.push({ id, code: 'not_in_options' });
        break;
      case 'link':
      case 'image':
        if (typeof v === 'string' && (v === '' || /^(https?:\/\/|\/)/.test(v))) out[id] = v;
        else problems.push({ id, code: 'invalid_link' });
        break;
      default:
        if (typeof v === 'string') out[id] = v;
        else problems.push({ id, code: 'not_text' });
    }
  }
  return { values: out, problems };
}

export const MAX_SECTIONS = 30;
const SECTION_ID = /^[A-Za-z0-9_-]{1,40}$/;

export interface SectionProblem {
  /** Field path, e.g. `sections.2.settings.heading` or `sections.0.blocks.1.type`. */
  path: string;
  code: SettingProblem['code'] | 'not_list' | 'too_many' | 'unknown_type' | 'invalid_id' | 'duplicate_id' | 'too_many_blocks';
  params?: Record<string, string | number>;
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks a home page layout against the theme's section types (theme API 1.3). */
export function validateSections(t: ThemeMeta, layout: unknown): { sections: SectionInstance[]; problems: SectionProblem[] } {
  const problems: SectionProblem[] = [];
  if (!Array.isArray(layout)) return { sections: [], problems: [{ path: 'sections', code: 'not_list' }] };
  if (layout.length > MAX_SECTIONS) problems.push({ path: 'sections', code: 'too_many', params: { max: MAX_SECTIONS } });
  const schemas = new Map((t.sectionSchemas ?? []).map((s) => [s.type, s]));
  const ids = new Set<string>();
  const sections: SectionInstance[] = [];
  layout.slice(0, MAX_SECTIONS).forEach((raw, i) => {
    const at = `sections.${i}`;
    const s = isObj(raw) ? raw : {};
    const schema = schemas.get(String(s.type));
    if (!schema) return problems.push({ path: `${at}.type`, code: 'unknown_type' });
    const id = String(s.id ?? '');
    if (!SECTION_ID.test(id)) problems.push({ path: `${at}.id`, code: 'invalid_id' });
    else if (ids.has(id)) problems.push({ path: `${at}.id`, code: 'duplicate_id' });
    ids.add(id);
    const checked = checkValues(schema.settings, isObj(s.settings) ? s.settings : {});
    for (const p of checked.problems) problems.push({ path: `${at}.settings.${p.id}`, code: p.code, params: p.params });
    const blocks: SectionBlock[] = [];
    const rawBlocks = Array.isArray(s.blocks) ? s.blocks : [];
    if (schema.max_blocks !== undefined && rawBlocks.length > schema.max_blocks) problems.push({ path: `${at}.blocks`, code: 'too_many_blocks', params: { max: schema.max_blocks } });
    rawBlocks.forEach((rb: unknown, j: number) => {
      const b = isObj(rb) ? rb : {};
      const bs = schema.blocks?.find((x) => x.type === b.type);
      if (!bs) return problems.push({ path: `${at}.blocks.${j}.type`, code: 'unknown_type' });
      const bid = String(b.id ?? '');
      if (!SECTION_ID.test(bid)) problems.push({ path: `${at}.blocks.${j}.id`, code: 'invalid_id' });
      const bc = checkValues(bs.settings, isObj(b.settings) ? b.settings : {});
      for (const p of bc.problems) problems.push({ path: `${at}.blocks.${j}.settings.${p.id}`, code: p.code, params: p.params });
      blocks.push({ id: bid, type: bs.type, settings: bc.values });
    });
    sections.push({ id, type: schema.type, settings: checked.values, blocks });
  });
  return { sections, problems };
}

const defaults = (schema: SettingSchema[]) => Object.fromEntries(schema.filter((s) => s.default !== undefined).map((s) => [s.id, s.default]));

/** Setting types whose values shop owners translate per storefront language. */
export const TRANSLATABLE_SETTINGS: SettingType[] = ['text', 'textarea', 'link'];

/**
 * Per-language text for one theme: `settings.<id>`, `sections.<section>.<id>` and
 * `sections.<section>.blocks.<block>.<id>` → text. Empty values fall back to the base text.
 */
export type ContentOverlay = Record<string, string>;

function overlaid(schema: SettingSchema[], values: Record<string, unknown>, overlay: ContentOverlay | undefined, prefix: string) {
  if (!overlay) return values;
  const out = { ...values };
  for (const f of schema) {
    const v = overlay[`${prefix}${f.id}`];
    if (TRANSLATABLE_SETTINGS.includes(f.type) && typeof v === 'string' && v.trim()) out[f.id] = v;
  }
  return out;
}

/** The home layout to render: the shop's own, else the theme's default, with setting defaults filled in. */
export function resolveSections(t: ThemeMeta, stored?: SectionInstance[] | null, overlay?: ContentOverlay): SectionInstance[] {
  const schemas = new Map((t.sectionSchemas ?? []).map((s) => [s.type, s]));
  return (stored ?? t.sectionsData ?? []).flatMap((s) => {
    const schema = schemas.get(s.type);
    if (!schema) return [];
    const blocks = (s.blocks ?? []).flatMap((b) => {
      const bs = schema.blocks?.find((x) => x.type === b.type);
      return bs ? [{ ...b, settings: overlaid(bs.settings, { ...defaults(bs.settings), ...b.settings }, overlay, `sections.${s.id}.blocks.${b.id}.`) }] : [];
    });
    return [{ ...s, settings: overlaid(schema.settings, { ...defaults(schema.settings), ...s.settings }, overlay, `sections.${s.id}.`), blocks }];
  });
}

/** The translatable field behind an overlay path, or null when the path names nothing translatable. */
export function contentField(t: ThemeMeta, layout: SectionInstance[], path: string): SettingSchema | null {
  const parts = path.split('.');
  const pick = (schema: SettingSchema[] | undefined, id: string | undefined) => {
    const f = schema?.find((x) => x.id === id);
    return f && TRANSLATABLE_SETTINGS.includes(f.type) ? f : null;
  };
  if (parts[0] === 'settings' && parts.length === 2) return pick(t.settingsSchema.flatMap((g) => g.settings), parts[1]);
  if (parts[0] !== 'sections') return null;
  const section = layout.find((s) => s.id === parts[1]);
  const schema = t.sectionSchemas?.find((x) => x.type === section?.type);
  if (!section || !schema) return null;
  if (parts.length === 3) return pick(schema.settings, parts[2]);
  if (parts.length === 5 && parts[2] === 'blocks') {
    const block = section.blocks.find((b) => b.id === parts[3]);
    return block ? pick(schema.blocks?.find((x) => x.type === block.type)?.settings, parts[4]) : null;
  }
  return null;
}

/** Merges defaults from the schema, settings_data.json and the tenant's overrides. */
export function resolveSettings(t: ThemeMeta, overrides: Record<string, unknown> = {}, overlay?: ContentOverlay): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const group of t.settingsSchema) for (const s of group.settings) out[s.id] = s.default;
  return overlaid(t.settingsSchema.flatMap((g) => g.settings), { ...out, ...t.settingsData, ...overrides }, overlay, 'settings.');
}

/** A theme's `locales/*.json` files as string maps: metadata keys (`_meta`) and non-string values are dropped. */
export function themeCatalogs(files: Record<string, Record<string, unknown>>): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(files).map(([locale, c]) => [locale, Object.fromEntries(Object.entries(c).filter((e): e is [string, string] => !e[0].startsWith('_') && typeof e[1] === 'string'))]),
  );
}

/** Theme strings: requested locale → theme default → English (FR-THM-6). */
export function translator(t: ThemeMeta, locale: string, overrides: Record<string, string> = {}) {
  const def = t.manifest.locales[0] ?? 'en';
  return (key: string, params: Record<string, string | number> = {}) => {
    const msg = overrides[key] ?? t.locales[locale]?.[key] ?? t.locales[def]?.[key] ?? t.locales.en?.[key] ?? key;
    // ICU plurals ({count, plural, one {…} other {…}}) and {params}, by the language's plural rules.
    return format(msg, params, locale);
  };
}

/** A setting value that may go into CSS: a colour, a number or a plain word, nothing that can break out. */
const SAFE_CSS_VALUE = /^(#[0-9a-f]{3,8}|-?\d+(\.\d+)?|[a-z][a-z-]{0,30}|(rgb|rgba|hsl|hsla|oklch)\([\d.,%\s/]+\))$/i;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Black or white, whichever reads better on a hex colour (WCAG contrast). */
export function contrastColor(hex: string): string {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#0a0a0a';
}

/**
 * Fills a theme's widget CSS (FR-THM-10, theme API 1.8). `{{ settings.accent | branding.primary_color | #0891b2 }}`
 * takes the first value that is set and safe for CSS; `{{ contrast: … }}` gives black or white text for it.
 * A placeholder with no usable value removes its whole declaration.
 */
export function fillWidgetCss(template: string, data: { settings: Record<string, unknown>; branding: Record<string, unknown> }): string {
  const pick = (expr: string) => {
    for (const part of expr.split('|').map((p) => p.trim())) {
      const [scope, key] = part.split('.', 2) as [string, string | undefined];
      const raw = key && (scope === 'settings' || scope === 'branding') ? data[scope][key] : key ? undefined : part;
      const v = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
      if (v && SAFE_CSS_VALUE.test(v)) return v;
    }
    return null;
  };
  const filled = template.replace(/\{\{\s*(contrast:)?([^}]*)\}\}/g, (_m, contrast: string | undefined, expr: string) => {
    const v = pick(expr);
    if (v === null) return '\uE000';
    return contrast ? (HEX.test(v) ? contrastColor(v) : '\uE000') : v;
  });
  // Declarations that lost their value go; the rest stays as the theme wrote it.
  return filled.replace(/[^;{}]*\uE000[^;{}]*;?/g, '').replace(/<\/style/gi, '');
}
