import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { invalid } from '../errors.ts';
import { audit } from '../events.ts';
import { exec, many, must } from '../sql.ts';

/**
 * Products that go with a product (FR-CAT-7). Staff choose accessories (offered with it when booking)
 * and related products; "often rented with" comes from the bookings themselves, once a week.
 */
export type RelationKind = 'accessory' | 'related' | 'often_rented_with';
const KINDS: RelationKind[] = ['accessory', 'related', 'often_rented_with'];
/** Most products kept per kind. */
const MAX = 12;

export interface RelatedProduct {
  id: string;
  name: string;
  slug: string;
  type: string;
  visibility: string;
  variant_id: string | null;
  score: number;
}

/** The related products of each kind, in the order staff set (often rented with: most bookings first). */
export async function relationsOf(ctx: Ctx, productIds: string[], opts: { publicOnly?: boolean } = {}): Promise<Map<string, Record<RelationKind, RelatedProduct[]>>> {
  const out = new Map<string, Record<RelationKind, RelatedProduct[]>>(productIds.map((id) => [id, { accessory: [], related: [], often_rented_with: [] }]));
  if (!productIds.length) return out;
  const rows = await many<any>(
    ctx,
    `SELECT r.product_id, r.kind, r.score, p.id, p.name, p.slug, p.type, p.visibility,
            (SELECT v.id FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL ORDER BY v.is_default DESC, v.position LIMIT 1) AS variant_id
       FROM product_relations r JOIN products p ON p.id = r.related_product_id
      WHERE r.product_id = ANY($1) AND p.deleted_at IS NULL AND p.visibility <> 'archived' ${opts.publicOnly ? `AND p.visibility = 'public'` : ''}
      ORDER BY r.position, r.score DESC, p.name`,
    [productIds],
  );
  for (const r of rows) out.get(r.product_id)![r.kind as RelationKind].push({ id: r.id, name: r.name, slug: r.slug, type: r.type, visibility: r.visibility, variant_id: r.variant_id, score: Number(r.score) });
  return out;
}

/** Sets the accessories and related products staff choose; "often rented with" is not set by hand. */
export async function setRelations(ctx: Ctx, productId: string, input: { accessory?: string[]; related?: string[] }) {
  await must(ctx, `SELECT 1 FROM products WHERE id = $1 AND deleted_at IS NULL`, [productId], 'product', productId);
  for (const kind of ['accessory', 'related'] as const) {
    const ids = input[kind];
    if (!ids) continue;
    const unique = [...new Set(ids)].filter((id) => id !== productId);
    if (unique.length > MAX) throw invalid(msg('error.too_many_related', { max: MAX }), [{ field: kind, code: 'too_many', message: msg('error.too_many_related', { max: MAX }) }]);
    const found = await many<{ id: string }>(ctx, `SELECT id FROM products WHERE id = ANY($1) AND deleted_at IS NULL`, [unique]);
    if (found.length !== unique.length) throw invalid(msg('error.unknown_related_product'), [{ field: kind, code: 'unknown', message: msg('error.unknown_related_product') }]);
    await exec(ctx, `DELETE FROM product_relations WHERE product_id = $1 AND kind = $2`, [productId, kind]);
    for (const [i, id] of unique.entries()) {
      await exec(ctx, `INSERT INTO product_relations (tenant_id, product_id, related_product_id, kind, position) VALUES ($1,$2,$3,$4,$5)`, [ctx.tenantId, productId, id, kind, i]);
    }
  }
  await audit(ctx, { entity_type: 'product', entity_id: productId, action: 'relations', after: input as any });
  return relationsToApi((await relationsOf(ctx, [productId])).get(productId)!);
}

export function relationsToApi(r: Record<RelationKind, RelatedProduct[]>) {
  return { object: 'product_relations', ...Object.fromEntries(KINDS.map((k) => [k, r[k]])) };
}

/**
 * Worker, weekly: for each product, the six others most often on the same booking in the last year (at
 * least two bookings), replacing last week's list.
 */
export async function computeOftenRentedWith(ctx: Ctx): Promise<number> {
  const pairs = await many<{ p: string; q: string; n: number }>(
    ctx,
    `WITH pairs AS (
       SELECT a.product_id AS p, b.product_id AS q, count(DISTINCT a.order_id)::int AS n
         FROM order_lines a JOIN order_lines b ON b.order_id = a.order_id AND b.product_id <> a.product_id
         JOIN orders o ON o.id = a.order_id
        WHERE a.parent_line_id IS NULL AND b.parent_line_id IS NULL AND a.product_id IS NOT NULL AND b.product_id IS NOT NULL
          AND o.status NOT IN ('draft', 'cancelled', 'expired') AND o.created_at > $1
        GROUP BY 1, 2 HAVING count(DISTINCT a.order_id) >= 2)
     SELECT p, q, n FROM (SELECT *, row_number() OVER (PARTITION BY p ORDER BY n DESC, q) AS r FROM pairs) x WHERE r <= 6`,
    [new Date(ctx.now.getTime() - 365 * 86_400_000)],
  );
  await exec(ctx, `DELETE FROM product_relations WHERE kind = 'often_rented_with'`);
  for (const x of pairs) {
    await exec(ctx, `INSERT INTO product_relations (tenant_id, product_id, related_product_id, kind, score) VALUES ($1,$2,$3,'often_rented_with',$4) ON CONFLICT DO NOTHING`, [ctx.tenantId, x.p, x.q, x.n]);
  }
  return pairs.length;
}
