import { error } from '@sveltejs/kit';
import { resolveSections, withPluginSections, type PageData, type Product, type SectionInstance } from '@openrent/theme-sdk';
import { sf, fail, localeQuery } from '#lib/server/api.ts';
import { readDates } from '#lib/server/session.ts';
import { themeFor } from '#lib/themes.ts';
import { shorten, type PageMeta } from '#lib/meta.ts';
import { t } from '#lib/i18n/index.ts';
import type { PageServerLoad } from './$types';

interface StorefrontPage {
  title: string;
  body_html: string;
  seo: { title: string | null; description: string | null };
  sections: SectionInstance[];
  content: Record<string, string>;
  plugin_sections: Record<string, string>;
}

/** `/pages/terms` is the rental terms; other pages are the shop's own, with their sections for this theme. */
export const load: PageServerLoad = async (event) => {
  const { shop, themeId, pluginSectionSchemas } = await event.parent();
  if (event.params.slug === 'terms') return { title: t('page.terms'), body: `${shop.terms.text}\n\n${t('page.terms_version', { version: shop.terms.version })}`, meta: { title: t('page.terms') } satisfies PageMeta };
  if (!/^[a-z0-9-]{1,120}$/.test(event.params.slug)) error(404, t('error.page_not_found'));
  try {
    const p = await sf<StorefrontPage>(event, `/pages/${event.params.slug}${localeQuery(event)}`);
    const sections = p.sections.length ? resolveSections(withPluginSections(themeFor(themeId), pluginSectionSchemas), p.sections, p.content) : [];
    // Product sections on a page show the catalogue as on the home page.
    let products: Product[] = [];
    if (sections.length) {
      const d = readDates(event.cookies);
      const qs = d.from && d.to ? `&from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}` : '';
      products = (await sf<{ data: Product[] }>(event, `/catalog/products?limit=100${qs}${localeQuery(event, '&')}`)).data;
    }
    const meta: PageMeta = { title: p.seo.title || p.title, description: p.seo.description || shorten(p.body_html.replace(/<[^>]+>/g, ' ')) };
    return { title: p.title, body: '', body_html: p.body_html, sections, products, pluginSections: p.plugin_sections, meta } satisfies PageData & Record<string, unknown>;
  } catch (e) {
    fail(e);
  }
};
