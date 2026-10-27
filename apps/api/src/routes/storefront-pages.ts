import { storefront, tenancy, themes } from '@openrent/core';
import type { Router } from '../http.ts';
import { IdParams, Json, Nullable, Type } from '../schemas.ts';

const Texts = Type.Object(
  { title: Type.Optional(Nullable(Type.String())), body: Type.Optional(Nullable(Type.String())), seo_title: Type.Optional(Nullable(Type.String())), seo_description: Type.Optional(Nullable(Type.String())) },
  { additionalProperties: false },
);
const PageBody = Type.Object(
  {
    title: Type.Optional(Type.String({ maxLength: 200 })),
    slug: Type.Optional(Type.String({ maxLength: 120 })),
    status: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('published')])),
    body: Type.Optional(Type.String({ maxLength: 100_000 })),
    seo: Type.Optional(Type.Object({ title: Type.Optional(Nullable(Type.String())), description: Type.Optional(Nullable(Type.String())) }, { additionalProperties: false })),
    translations: Type.Optional(Type.Record(Type.String({ maxLength: 10 }), Texts)),
  },
  { additionalProperties: false },
);
const ThemeParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), theme: Type.String({ minLength: 1, maxLength: 64 }) });
const ThemeLocaleParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), theme: Type.String({ minLength: 1, maxLength: 64 }), locale: Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }) });
const NavItem = Type.Object(
  {
    kind: Type.Union(['home', 'search', 'category', 'page', 'product', 'url'].map((k) => Type.Literal(k))),
    target: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
    label: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    translations: Type.Optional(Type.Record(Type.String({ maxLength: 10 }), Type.String({ maxLength: 200 }))),
  },
  { additionalProperties: false },
);

/** The shop's own storefront pages and its menus (Admin → Themes → Pages). */
export function registerStorefrontPages(r: Router) {
  const T = ['Storefront pages'];
  const installed = (ctx: Parameters<typeof themes.availableThemes>[0]) => themes.availableThemes(ctx, r.deps.themes);

  r.get('/storefront_pages', { permission: 'themes:manage', tags: T, summary: 'The shop’s storefront pages' }, async (ctx) => storefront.listPages(ctx));
  r.post('/storefront_pages', { permission: 'themes:manage', tags: T, summary: 'Create a page (a draft unless `status` is published); `slug` comes from the title when left out', body: PageBody }, async (ctx, req) => storefront.createPage(ctx, req.body));
  r.get('/storefront_pages/:id', { permission: 'themes:manage', tags: T, summary: 'One page with its sections per theme', params: IdParams }, async (ctx, req) => storefront.getPage(ctx, req.params.id));
  r.patch('/storefront_pages/:id', { permission: 'themes:manage', tags: T, summary: 'Change a page’s title, address, text, status or translations', params: IdParams, body: PageBody }, async (ctx, req) => storefront.updatePage(ctx, req.params.id, req.body));
  r.delete('/storefront_pages/:id', { permission: 'themes:manage', tags: T, summary: 'Delete a page', params: IdParams }, async (ctx, req) => storefront.deletePage(ctx, req.params.id));
  r.put(
    '/storefront_pages/:id/sections/:theme',
    { permission: 'themes:manage', tags: T, summary: 'Save a page’s sections for one theme (checked against its section types); null removes them', params: ThemeParams, body: Type.Object({ sections: Type.Union([Type.Array(Json, { maxItems: 100 }), Type.Null()]) }) },
    async (ctx, req) => storefront.updatePageSections(ctx, await installed(ctx), req.params.id, req.params.theme, req.body.sections),
  );
  r.put(
    '/storefront_pages/:id/content/:theme/:locale',
    { permission: 'themes:manage', tags: T, summary: 'Translate a page’s section texts for one theme into one storefront language', params: ThemeLocaleParams, body: Type.Object({ values: Type.Record(Type.String({ maxLength: 200 }), Nullable(Type.String({ maxLength: 5000 }))) }) },
    async (ctx, req) => storefront.updatePageContent(ctx, await installed(ctx), req.params.id, req.params.theme, req.params.locale, req.body.values),
  );

  r.get('/storefront_navigation', { permission: 'themes:manage', tags: T, summary: 'The storefront’s header and footer menus' }, async (ctx) => ({ object: 'storefront_navigation', ...(await tenancy.getSettings(ctx)).navigation }));
  r.put(
    '/storefront_navigation',
    { permission: 'themes:manage', tags: T, summary: 'Replace the header and footer menus; an empty header leaves the theme’s own menu', body: Type.Object({ header: Type.Array(NavItem, { maxItems: 50 }), footer: Type.Array(NavItem, { maxItems: 50 }) }, { additionalProperties: false }) },
    async (ctx, req) => ({ object: 'storefront_navigation', ...(await tenancy.updateSettings(ctx, { navigation: { header: req.body.header, footer: req.body.footer } })).navigation }),
  );
}
