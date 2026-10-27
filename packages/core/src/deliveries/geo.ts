import type { Ctx } from '../context.ts';
import { exec, one } from '../sql.ts';
import { pluginConfig } from '../plugins/index.ts';
import type { QuoteOptions } from '../pricing/engine.ts';

/**
 * Addresses on the map (FR-PR-8): the distance a delivery fee is priced by, and the coordinates of
 * deliveries for route exports. A geocoder plugin does the lookups; answers are kept per shop, as
 * geocoding services ask. Without a plugin, distance fees cannot be priced and say so.
 */
type Point = { lat: number; lon: number };

/** One line from an address object: street, postcode and city, country. */
export function addressLine(a: Record<string, unknown> | null | undefined): string {
  if (!a) return '';
  const part = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
  return [part('line1'), part('line2'), [part('postal_code'), part('city')].filter(Boolean).join(' '), part('country')].filter(Boolean).join(', ');
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function geocoder(ctx: Ctx) {
  const g = ctx.plugins.geocoder();
  if (!g) return null;
  const pluginId = ctx.plugins.pluginIdOf(g.id) ?? g.id;
  const { enabled, config } = await pluginConfig(ctx, pluginId);
  const pctx = { tenantId: ctx.tenantId, config, logger: ctx.logger };
  return enabled && g.isConfigured(pctx) ? { g, pctx, factor: Number(config.road_factor) > 0 ? Number(config.road_factor) : 1.3 } : null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 300);

/** Where an address is; null when the map does not know it, undefined without a geocoder. */
export async function locate(ctx: Ctx, address: string): Promise<Point | null | undefined> {
  const q = norm(address);
  if (!q) return null;
  const cached = await one<{ lat: number | null; lon: number | null }>(ctx, `SELECT lat, lon FROM geocode_cache WHERE query = $1`, [q]);
  if (cached) return cached.lat === null || cached.lon === null ? null : { lat: cached.lat, lon: cached.lon };
  const geo = await geocoder(ctx);
  if (!geo) return undefined;
  const p = await geo.g.geocode(geo.pctx, address);
  await exec(ctx, `INSERT INTO geocode_cache (tenant_id, query, lat, lon) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, query) DO NOTHING`, [ctx.tenantId, q, p?.lat ?? null, p?.lon ?? null]);
  return p;
}

/** Kilometres from `from` to `to` for a distance fee, by road when the plugin can route; else why there is no distance. */
export async function distanceKm(ctx: Ctx, from: string, to: string | null | undefined): Promise<NonNullable<QuoteOptions['distance']>> {
  if (!to?.trim()) return { error: 'address_required' };
  const geo = await geocoder(ctx);
  if (!geo) return { error: 'address_not_found' };
  const [a, b] = [await locate(ctx, from), await locate(ctx, to)];
  if (!a || !b) return { error: 'address_not_found' };
  const road = geo.g.route ? await geo.g.route(geo.pctx, a, b).catch(() => null) : null;
  const km = road?.km ?? haversineKm(a, b) * geo.factor;
  return { km: Math.round(km * 10) / 10 };
}

/** Best effort: puts a delivery on the map when its address changes; a failed lookup changes nothing. */
export async function placeDelivery(ctx: Ctx, deliveryId: string, address: Record<string, unknown> | null | undefined) {
  try {
    const p = await locate(ctx, addressLine(address));
    if (p !== undefined) await exec(ctx, `UPDATE deliveries SET lat = $2, lon = $3 WHERE id = $1`, [deliveryId, p?.lat ?? null, p?.lon ?? null]);
  } catch (err) {
    ctx.logger.warn({ err, delivery: deliveryId }, 'delivery address could not be placed on the map');
  }
}
