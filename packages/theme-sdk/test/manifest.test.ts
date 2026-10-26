import { describe, expect, it } from 'vitest';
import { contentField, themeCatalogs, resolveSections, resolveSettings, satisfies, validateSections, validateTheme, translator, type ThemeModule } from '../src/manifest.ts';

const base: ThemeModule = {
  manifest: { id: 'x', name: 'X', version: '1.0.0', author: 'a', license: 'MIT', compat: '^1.0.0', locales: ['en'] },
  settingsSchema: [],
  settingsData: {},
  layout: {},
  templates: { index: {}, collection: {}, product: {}, cart: {}, checkout: {}, 'order-confirmation': {}, page: {}, '404': {} },
  locales: { en: { hello: 'Hello {name}' } },
};

describe('theme manifest', () => {
  it('accepts a complete compatible theme', () => expect(validateTheme(base)).toEqual([]));
  it('refuses an incompatible API range', () => expect(validateTheme({ ...base, manifest: { ...base.manifest, compat: '^2.0.0' } })[0]).toMatch(/requires theme API/));
  it('reports missing templates', () => expect(validateTheme({ ...base, templates: {} }).length).toBe(8));
  it('implements caret ranges', () => {
    expect(satisfies('1.4.0', '^1.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('1.0.0', '^1.2.0')).toBe(false);
  });
  it('falls back to English strings', () => expect(translator(base, 'et')('hello', { name: 'Mari' })).toBe('Hello Mari'));
});

describe('theme API 1.3', () => {
  const withSections: ThemeModule = {
    ...base,
    sectionSchemas: [
      { type: 'hero', name: 'Hero', settings: [{ id: 'heading', type: 'text', label: 'Heading', default: 'Hi' }, { id: 'height', type: 'range', label: 'Height', min: 1, max: 3, default: 2 }] },
      { type: 'faq', name: 'FAQ', settings: [], blocks: [{ type: 'item', name: 'Q&A', settings: [{ id: 'q', type: 'text', label: 'Question', default: '?' }] }], max_blocks: 2 },
    ],
    sectionsData: [{ id: 'hero', type: 'hero', settings: {}, blocks: [] }],
  };

  it('needs no optional templates (account, search) and still runs on 1.3', () => {
    expect(validateTheme(base)).toEqual([]);
    expect(satisfies('1.3.0', base.manifest.compat)).toBe(true);
  });
  it('validates a layout and reports problems by path', () => {
    const { problems } = validateSections(withSections, [
      { id: 'a', type: 'hero', settings: { height: 9 } },
      { id: 'a', type: 'nope' },
      { id: 'a', type: 'faq', blocks: [{ id: 'b1', type: 'item', settings: { q: 1 } }, { id: 'b2', type: 'item' }, { id: 'b3', type: 'item' }] },
    ]);
    expect(problems.map((p) => `${p.path}:${p.code}`)).toEqual([
      'sections.0.settings.height:out_of_range',
      'sections.1.type:unknown_type',
      'sections.2.id:duplicate_id',
      'sections.2.blocks:too_many_blocks',
      'sections.2.blocks.0.settings.q:not_text',
    ]);
    expect(validateSections(withSections, 'x').problems[0]!.code).toBe('not_list');
  });
  it('fills defaults and falls back to the theme layout', () => {
    expect(resolveSections(withSections, null)).toEqual([{ id: 'hero', type: 'hero', settings: { heading: 'Hi', height: 2 }, blocks: [] }]);
    const own = resolveSections(withSections, [{ id: 'f', type: 'faq', settings: {}, blocks: [{ id: 'b', type: 'item', settings: {} }] }, { id: 'gone', type: 'removed', settings: {}, blocks: [] }]);
    expect(own).toEqual([{ id: 'f', type: 'faq', settings: {}, blocks: [{ id: 'b', type: 'item', settings: { q: '?' } }] }]);
  });
  it('refuses a theme whose default layout is invalid', () => {
    expect(validateTheme({ ...withSections, sectionsData: [{ id: 'x', type: 'nope', settings: {}, blocks: [] }] })[0]).toMatch(/sections_data.json/);
  });
});

describe('languages', () => {
  const theme: ThemeModule = {
    ...base,
    locales: { en: { found: '{count, plural, one {# result} other {# results}}' }, de: { found: '{count, plural, one {# Treffer} other {# Treffer}}' } },
    settingsSchema: [{ name: 'Texts', settings: [{ id: 'tagline', type: 'text', label: 'Tagline', default: 'Rent' }, { id: 'accent', type: 'color', label: 'Accent', default: '#000' }] }],
    sectionSchemas: [{ type: 'faq', name: 'FAQ', settings: [{ id: 'title', type: 'text', label: 'Title', default: 'FAQ' }], blocks: [{ type: 'item', name: 'Q&A', settings: [{ id: 'q', type: 'text', label: 'Question', default: '?' }] }] }],
  };
  const layout = [{ id: 'f', type: 'faq', settings: {}, blocks: [{ id: 'b', type: 'item', settings: { q: 'Why?' } }] }];

  it('applies plural rules in theme texts', () => {
    expect(translator(theme, 'en')('found', { count: 1 })).toBe('1 result');
    expect(translator(theme, 'de')('found', { count: 3 })).toBe('3 Treffer');
  });
  it('overlays translated texts and keeps the base text when a translation is empty', () => {
    const overlay = { 'sections.f.title': 'Fragen', 'sections.f.blocks.b.q': '', 'settings.tagline': 'Mieten', 'settings.accent': '#fff' };
    expect(resolveSections(theme, layout, overlay)[0]).toMatchObject({ settings: { title: 'Fragen' }, blocks: [{ settings: { q: 'Why?' } }] });
    // Only text settings take translations.
    expect(resolveSettings(theme, {}, overlay)).toMatchObject({ tagline: 'Mieten', accent: '#000' });
  });
  it('accepts content paths of translatable fields only', () => {
    expect(contentField(theme, layout, 'sections.f.blocks.b.q')?.id).toBe('q');
    expect(contentField(theme, layout, 'settings.tagline')?.id).toBe('tagline');
    expect(contentField(theme, layout, 'settings.accent')).toBeNull();
    expect(contentField(theme, layout, 'sections.missing.title')).toBeNull();
  });
});

describe('themeCatalogs', () => {
  it('drops metadata from catalogue files', () => {
    expect(themeCatalogs({ de: { _meta: { machine_draft: true }, hi: 'Hallo' } })).toEqual({ de: { hi: 'Hallo' } });
  });
});
