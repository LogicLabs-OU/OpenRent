import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Liquid } from 'liquidjs';

/**
 * The theme app blocks, rendered with LiquidJS and the Shopify objects they use (app metafields, block
 * settings, the request), and their locale files. Shopify itself renders them on a dev store.
 */
const dir = new URL('../extensions/openrent-blocks/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');
const locale = (name: string) => JSON.parse(read(`locales/${name}`));

function engine(lang = 'en') {
  const liquid = new Liquid();
  liquid.registerTag('schema', {
    parse(_token, remain) {
      // The schema is for the theme editor; skip to {% endschema %}.
      while (remain.length) {
        const tok: any = remain.shift();
        if (tok.name === 'endschema') return;
      }
    },
    render: () => '',
  });
  const strings = locale(lang === 'en' ? 'en.default.json' : `${lang}.json`);
  liquid.registerFilter('t', (key: string) => key.split('.').reduce((o: any, k) => o?.[k], strings) ?? key);
  liquid.registerFilter('asset_url', (f: string) => `https://cdn.shopify.com/extensions/openrent/assets/${f}`);
  liquid.registerFilter('handleize', (s: string) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  return liquid;
}

const config = { api_url: 'https://rent.example.com', shop: 'demo', storefront_url: 'https://shop.example.com' };
const render = (block: string, settings: Record<string, unknown>, o: { config?: unknown; design?: boolean; lang?: string } = {}) =>
  engine(o.lang).parseAndRender(read(`blocks/${block}.liquid`), {
    app: { metafields: { openrent: { config: { value: o.config === undefined ? config : o.config } } } },
    block: { settings, shopify_attributes: 'data-block' },
    request: { locale: { iso_code: o.lang === 'de' ? 'de-DE' : 'en' }, design_mode: !!o.design },
  });

describe('theme app blocks', () => {
  it('write the widget elements with the shop’s OpenRent settings', async () => {
    const p = await render('product', { product: 'City Bike' });
    expect(p).toContain('<openrent-product api="https://rent.example.com" shop="demo" storefront="https://shop.example.com" lang="en" product="city-bike" data-block></openrent-product>');
    expect(p).toContain('<script src="https://cdn.shopify.com/extensions/openrent/assets/openrent-loader.js" defer></script>');
    const c = await render('category', { category: 'bikes', limit: 6 }, { lang: 'de' });
    expect(c).toContain('category="bikes" limit="6"');
    expect(c).toContain('lang="de"');
    const b = await render('book-button', { product: '', label: '"Book" <now>' });
    expect(b).toContain('label="&#34;Book&#34; &lt;now&gt;"');
    expect(b).toContain('data-api="https://rent.example.com"');
  });

  it('show nothing to visitors until the shop is connected, and tell the merchant in the editor', async () => {
    expect((await render('product', { product: 'bike' }, { config: null })).trim()).toBe('');
    expect(await render('category', {}, { config: null, design: true, lang: 'de' })).toContain('Verbinden Sie zuerst OpenRent');
    expect((await render('product', { product: '' })).trim()).toBe('');
  });

  it('have every label in every language', () => {
    const files = readdirSync(new URL('locales/', dir));
    const keys = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    const en = { plain: keys(locale('en.default.json')).sort(), schema: keys(locale('en.default.schema.json')).sort() };
    for (const f of files) expect(keys(locale(f)).sort(), f).toEqual(f.includes('schema') ? en.schema : en.plain);
    expect(files.length).toBe(14);
    // Every t: label the blocks use is there.
    for (const block of readdirSync(new URL('blocks/', dir))) {
      for (const [, key] of read(`blocks/${block}`).matchAll(/"t:([\w.]+)"/g)) expect(en.schema, `${block}: ${key}`).toContain(key);
    }
  });
});
