import { definePlugin, type Geocoder, type ProviderContext } from '@openrent/plugin-sdk';

/**
 * Addresses on the map with OpenStreetMap (FR-PR-8): Nominatim finds an address, and an OSRM server,
 * when the shop has one, gives the distance by road. The public Nominatim server allows at most one
 * request a second from an application that names itself and gives a contact, so requests wait their
 * turn here; a shop's own server may allow more. OpenRent keeps every answer, so each address is
 * looked up once.
 */
const PUBLIC = 'https://nominatim.openstreetmap.org';
const VERSION = '0.1.0';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const base = (config: Record<string, unknown>) => (str(config.nominatim_url) ?? PUBLIC).replace(/\/+$/, '');

/** Requests a second the server allows: one for the public server, whatever the shop says for its own. */
export function rateFor(config: Record<string, unknown>) {
  if (base(config) === PUBLIC) return 1;
  const n = Number(config.requests_per_second);
  return n > 0 ? Math.min(n, 50) : 1;
}

/** One queue per server, shared by every shop on this installation. */
const queues = new Map<string, { next: number; tail: Promise<void> }>();

async function turn(server: string, perSecond: number) {
  const q = queues.get(server) ?? { next: 0, tail: Promise.resolve() };
  queues.set(server, q);
  const mine = q.tail.then(async () => {
    const wait = q.next - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    q.next = Date.now() + Math.ceil(1000 / perSecond);
  });
  q.tail = mine.catch(() => undefined);
  return mine;
}

const userAgent = (config: Record<string, unknown>) => `OpenRent/${VERSION} (geocode-osm${str(config.email) ? `; ${str(config.email)}` : ''})`;

export async function search(ctx: ProviderContext, address: string): Promise<{ lat: number; lon: number } | null> {
  const server = base(ctx.config);
  const url = new URL(`${server}/search`);
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const countries = str(ctx.config.country_codes)?.toLowerCase().replace(/\s+/g, '');
  if (countries) url.searchParams.set('countrycodes', countries);
  const email = str(ctx.config.email);
  if (email) url.searchParams.set('email', email);
  await turn(server, rateFor(ctx.config));
  const res = await fetch(url, { headers: { 'user-agent': userAgent(ctx.config), accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
  const list = (await res.json()) as { lat?: string; lon?: string }[];
  const hit = Array.isArray(list) ? list[0] : undefined;
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  return hit && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Kilometres by road from OSRM; null when no road joins the points. */
export async function route(ctx: ProviderContext, from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<{ km: number } | null> {
  const server = str(ctx.config.osrm_url)?.replace(/\/+$/, '');
  if (!server) return null;
  const res = await fetch(`${server}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`, {
    headers: { 'user-agent': userAgent(ctx.config), accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; routes?: { distance?: number }[] };
  if (body.code === 'NoRoute') return null;
  const metres = body.routes?.[0]?.distance;
  if (!res.ok || body.code !== 'Ok' || typeof metres !== 'number') throw new Error(`OSRM: ${body.code ?? `HTTP ${res.status}`}`);
  return { km: metres / 1000 };
}

export function osmGeocoder(): Geocoder {
  return {
    id: 'osm',
    // The public server asks for a contact; a shop's own server needs none.
    isConfigured: (ctx) => base(ctx.config) !== PUBLIC || !!str(ctx.config.email),
    geocode: search,
    route: (ctx, from, to) => (str(ctx.config.osrm_url) ? route(ctx, from, to) : Promise.resolve(null)),
  };
}

export default definePlugin({
  id: 'geocode-osm',
  name: 'OpenStreetMap geocoding',
  version: VERSION,
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.7.0',
  permissions: ['network'],
  settings: [
    { key: 'email', label: 'Contact email', type: 'text', help: 'Sent with each lookup, as the public Nominatim server asks. Needed unless you run your own server.' },
    { key: 'nominatim_url', label: 'Nominatim server', type: 'text', help: `Default ${PUBLIC} (at most one lookup a second)` },
    { key: 'requests_per_second', label: 'Lookups a second (own server only)', type: 'number' },
    { key: 'country_codes', label: 'Countries', type: 'text', help: 'Only find addresses in these countries, e.g. "de,at,ch"' },
    { key: 'osrm_url', label: 'OSRM server', type: 'text', help: 'For distances by road. Without one, the straight line times the road factor is used.' },
    { key: 'road_factor', label: 'Road factor', type: 'number', help: 'Straight-line distance times this, when there is no OSRM server (default 1.3)' },
  ],
  setup(api) {
    api.registerGeocoder(osmGeocoder());
  },
});
