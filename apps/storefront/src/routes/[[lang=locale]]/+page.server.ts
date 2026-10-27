import { sf, fail, localeQuery, localPath } from '#lib/server/api.ts';
import { shopLd, type PageMeta } from '#lib/meta.ts';
import { readDates } from '#lib/server/session.ts';
import { themeFor } from '#lib/themes.ts';
import { resolveSections, withPluginSections } from '@openrent/theme-sdk';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { themeId, themeSections, themeContent, pluginSectionSchemas, shop, seo } = await event.parent();
  // Plugins' section types count for themes that take them (FR-THM-12).
  const sections = resolveSections(withPluginSections(themeFor(themeId), pluginSectionSchemas), themeSections, themeContent);
  const d = readDates(event.cookies);
  const qs = d.from && d.to ? `&from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}` : '';
  try {
    const r = await sf(event, `/catalog/products?limit=100${qs}${localeQuery(event, '&')}`);
    const home = seo.base_url.replace(/\/$/, '') + localPath(event, '/');
    const meta: PageMeta = { jsonld: shopLd({ name: shop.tenant.name, base: seo.base_url, home, logo: shop.tenant.branding?.logo_url, locations: shop.locations }) };
    return { products: r.data, sections, meta };
  } catch (e) {
    fail(e);
  }
};
