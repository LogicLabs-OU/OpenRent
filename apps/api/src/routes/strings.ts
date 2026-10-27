import { strings, themes, AppError, serverT, type Ctx } from '@openrent/core';
import type { Router } from '../http.ts';
import { Type } from '../schemas.ts';
import sfEn from '../../../storefront/src/lib/i18n/en.json' with { type: 'json' };
import sfDe from '../../../storefront/src/lib/i18n/de.json' with { type: 'json' };
import sfFr from '../../../storefront/src/lib/i18n/fr.json' with { type: 'json' };
import sfEs from '../../../storefront/src/lib/i18n/es.json' with { type: 'json' };
import sfEt from '../../../storefront/src/lib/i18n/et.json' with { type: 'json' };
import sfJa from '../../../storefront/src/lib/i18n/ja.json' with { type: 'json' };
import sfNl from '../../../storefront/src/lib/i18n/nl.json' with { type: 'json' };

/** The shop's own wording (FR-I18N-6): Settings → Translations. */
export function registerStrings(r: Router) {
  const S = ['Translations'];
  const storefrontTexts = { en: sfEn, de: sfDe, fr: sfFr, es: sfEs, et: sfEt, ja: sfJa, nl: sfNl };

  /** Every namespace a shop can reword: storefront, emails, documents, its themes and plugins. */
  async function namespaces(ctx: Ctx) {
    const list: strings.StringNamespace[] = [strings.namespaceFrom('storefront', 'storefront', 'storefront', storefrontTexts), ...strings.serverNamespaces()];
    for (const th of await themes.availableThemes(ctx, r.deps.themes)) list.push(strings.namespaceFrom(`theme:${th.manifest.id}`, 'theme', th.manifest.name, th.locales));
    for (const [id, locales] of r.deps.plugins.locales) {
      const status = r.deps.plugins.statuses.find((p) => p.id === id);
      list.push(strings.namespaceFrom(`plugin:${id}`, 'plugin', status?.name ?? id, locales));
    }
    return list;
  }
  async function find(ctx: Ctx, id: string) {
    const ns = (await namespaces(ctx)).find((n) => n.id === id);
    if (!ns) throw new AppError('not_found', 404, serverT('strings.unknown_namespace', { id }));
    return ns;
  }

  r.get('/string_namespaces', { permission: 'tenant:write', tags: S, summary: 'Sets of texts the shop can reword' }, async (ctx) => ({
    object: 'list',
    data: (await namespaces(ctx)).map((n) => ({ object: 'string_namespace', id: n.id, kind: n.kind, name: n.name, keys: Object.keys(n.catalogs.en ?? {}).length })),
  }));
  r.get(
    '/strings',
    {
      permission: 'tenant:write',
      tags: S,
      summary: 'Built-in texts of a namespace in one language with the shop’s wording; search with q, only reworded ones with changed=true',
      querystring: Type.Object({ namespace: Type.String(), locale: Type.String(), q: Type.Optional(Type.String({ maxLength: 200 })), changed: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })), offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
    },
    async (ctx, req) => strings.listStrings(ctx, await find(ctx, req.query.namespace), req.query),
  );
  r.put(
    '/strings/:namespace/:locale',
    {
      permission: 'tenant:write',
      tags: S,
      summary: 'Reword texts; null or "" restores the built-in text. Placeholders must stay the same',
      params: Type.Object({ namespace: Type.String({ maxLength: 100 }), locale: Type.String({ maxLength: 10 }) }),
      body: Type.Object({ values: Type.Record(Type.String({ maxLength: 200 }), Type.Union([Type.String(), Type.Null()])) }),
    },
    async (ctx, req) => strings.saveStrings(ctx, await find(ctx, req.params.namespace), req.params.locale, req.body.values),
  );
  r.get(
    '/strings/:namespace/:locale/catalog',
    { tags: S, summary: 'Texts of a namespace in one language with the shop’s wording applied (for plugin admin bundles)', params: Type.Object({ namespace: Type.String({ maxLength: 100 }), locale: Type.String({ maxLength: 10 }) }) },
    async (ctx, req) => ({ object: 'catalog', namespace: req.params.namespace, locale: req.params.locale, strings: await strings.mergedCatalog(ctx, await find(ctx, req.params.namespace), req.params.locale) }),
  );
}
