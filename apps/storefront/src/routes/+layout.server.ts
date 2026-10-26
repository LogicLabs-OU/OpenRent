import type { SectionInstance, Shop } from '@openrent/theme-sdk';
import { resolveSettings } from '@openrent/theme-sdk';
import { error, redirect } from '@sveltejs/kit';
import { pickLocale } from '@openrent/i18n';
import { sf, fail, localeOf, localeQuery } from '#lib/server/api.ts';
import { readDates, cartId, setPreview, accountToken, setAccount, langCookie, setLangCookie } from '#lib/server/session.ts';
import { SfError } from '#lib/server/api.ts';
import { themeFor } from '#lib/themes.ts';
import { themeAssets } from '#lib/server/theme-assets.ts';
import { t } from '#lib/i18n/index.ts';
import type { LayoutServerLoad } from './$types';
import type { CheckoutFieldDef } from '#lib/extensions.svelte.ts';

export const load: LayoutServerLoad = async (event) => {
  event.depends('or:shop');
  let s: any;
  const q = localeQuery(event);
  try {
    s = await sf(event, `/settings${q}`);
  } catch (e) {
    // An expired or foreign preview link falls back to the live theme.
    if (e instanceof SfError && e.code === 'preview_invalid') {
      setPreview(event.cookies, null, event.url.protocol === 'https:');
      s = await sf(event, `/settings${q}`).catch(fail);
    } else fail(e);
  }
  // Languages (FR-SF-6): the default has plain URLs, the others a prefix such as /de.
  const locales: string[] = s.locales?.length ? s.locales : [s.default_locale ?? 'en'];
  const defaultLocale: string = s.default_locale ?? locales[0]!;
  const prefix = (event.params as { lang?: string }).lang;
  const rest = (prefix ? event.url.pathname.slice(prefix.length + 1) : event.url.pathname) || '/';
  if (prefix && !locales.includes(prefix)) error(404, t('error.page_not_found', {}, defaultLocale));
  if (prefix === defaultLocale) redirect(301, `${rest}${event.url.search}`);
  // First visit: follow the browser's language when the shop offers it; a choice made once sticks.
  if (!prefix && !langCookie(event.cookies) && event.request.method === 'GET') {
    const wanted = pickLocale(event.request.headers.get('accept-language'), locales);
    if (wanted && wanted !== defaultLocale) redirect(302, `/${wanted}${rest === '/' ? '' : rest}${event.url.search}`);
  }
  const locale = localeOf(event) ?? defaultLocale;
  setLangCookie(event.cookies, locale, event.url.protocol === 'https:');
  event.locals.htmlLang = locale;
  event.locals.csp = s.csp ?? {};
  // A child theme renders with its parent's code (FR-THM-8).
  const theme = themeFor(s.theme?.code_id ?? s.theme?.id);
  let cartCount = 0;
  const cid = cartId(event.cookies);
  if (cid) {
    try {
      const c = await sf(event, `/checkout_sessions/${cid}${q}`);
      if (c.status === 'open') cartCount = c.lines.reduce((a: number, l: any) => a + l.quantity, 0);
    } catch {
      /* stale cart cookie */
    }
  }
  // The header shows who is signed in; an expired session clears its cookie.
  let customer: Shop['customer'] = null;
  if (accountToken(event.cookies)) {
    try {
      const a = await sf<{ name: string; email: string }>(event, '/account');
      customer = { name: a.name, email: a.email };
    } catch (e) {
      if (e instanceof SfError && e.status === 401) setAccount(event.cookies, null, event.url.protocol === 'https:');
    }
  }
  const shop: Shop = {
    tenant: s.tenant,
    locations: s.locations,
    categories: s.categories,
    terms: s.terms,
    cancellation_policy: s.cancellation_policy,
    payment: s.payment,
    locale,
    locales: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)],
    dates: readDates(event.cookies),
    cartCount,
    settings: resolveSettings(theme, s.theme?.settings ?? {}, s.theme?.content),
    displayPricesIncludingTax: s.display_prices_including_tax,
    customer,
    features: { document_pdfs: !!s.features?.document_pdfs, accounts: true },
    // Child theme files come from the API; code themes' from their hashed assets/ URLs.
    assets: { ...themeAssets(theme.manifest.id), ...(s.theme?.assets ?? {}) },
    strings: s.strings ?? {},
  };
  return { shop, extensions: (s.extensions ?? { checkout_fields: [], scripts: [] }) as { checkout_fields: CheckoutFieldDef[]; scripts: { plugin: string; src: string; consent: 'necessary' | 'analytics' | 'marketing' }[] }, code: (s.code ?? { css: '', header_html: '', footer_html: '' }) as { css: string; header_html: string; footer_html: string }, themeCss: (s.theme?.css ?? '') as string, themeId: theme.manifest.id, themeOverrides: (s.theme?.translations ?? {}) as Record<string, Record<string, string>>, themeSections: (s.theme?.sections ?? null) as SectionInstance[] | null, themeContent: (s.theme?.content ?? {}) as Record<string, string>, preview: s.theme?.preview ? theme.manifest.name : null };
};
