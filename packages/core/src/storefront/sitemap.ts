import type { Ctx } from '../context.ts';
import { many, must, one } from '../sql.ts';
import { storefrontBase } from '../domains/index.ts';
import { resolveSettings } from '../tenancy/settings.ts';

/**
 * What the storefront lists for search engines: the home page, published pages, categories and public products, as
 * paths without a language prefix. The storefront adds one address per language, with alternates.
 */
export async function sitemap(ctx: Ctx, q: { offset?: number; limit?: number } = {}) {
  const t = await must<any>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const sf = resolveSettings(t.settings).storefront;
  const pages = `SELECT '/' AS path, NULL::timestamptz AS updated_at, 0 AS kind, '' AS sort
    UNION ALL SELECT '/pages/' || slug, updated_at, 1, slug FROM storefront_pages WHERE deleted_at IS NULL AND status = 'published'
    UNION ALL SELECT '/c/' || slug, updated_at, 2, slug FROM categories WHERE deleted_at IS NULL
    UNION ALL SELECT '/p/' || slug, updated_at, 3, slug FROM products WHERE deleted_at IS NULL AND visibility = 'public'`;
  const total = Number((await one<{ n: string }>(ctx, `SELECT count(*) AS n FROM (${pages}) x`))!.n);
  const rows = await many<{ path: string; updated_at: string | null }>(ctx, `SELECT path, updated_at FROM (${pages}) x ORDER BY kind, sort OFFSET $1 LIMIT $2`, [q.offset ?? 0, q.limit ?? 50_000]);
  return {
    object: 'storefront_sitemap',
    base_url: await storefrontBase(ctx),
    default_locale: sf.default_locale,
    locales: [sf.default_locale, ...sf.locales.filter((l) => l !== sf.default_locale)],
    total,
    data: rows.map((r) => ({ path: r.path, updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null })),
  };
}
