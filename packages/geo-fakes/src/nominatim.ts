import { serve, type Req, type Reply } from './server.ts';

/**
 * Nominatim's `GET /search?q=…&format=jsonv2&limit=1`. As the public server does: requests without a
 * User-Agent that names the application (or with a library's default one) get 403, requests faster
 * than the allowed rate get 429, and answers are arrays of `{ lat, lon, display_name }` with the
 * coordinates as strings. `countrycodes` limits the search; an unknown place is an empty array.
 */
export interface Place {
  /** Words that must all appear in the query (case does not matter). */
  match: string;
  lat: number;
  lon: number;
  country?: string;
  name?: string;
}

export interface NominatimFake {
  url: string;
  places: Place[];
  /** Every search that got through: the query, User-Agent and email parameter. */
  searches: { q: string; userAgent: string; email: string | null }[];
  /** Requests refused for coming too fast. */
  throttled: number;
  close(): Promise<void>;
}

const DEFAULT_AGENTS = /^(node|undici|node-fetch|axios|python-requests|curl|wget)\b/i;

export async function startNominatimFake(opts: { places?: Place[]; minIntervalMs?: number } = {}): Promise<NominatimFake> {
  const places = [...(opts.places ?? [])];
  const minInterval = opts.minIntervalMs ?? 1000;
  const searches: NominatimFake['searches'] = [];
  let last = 0;
  const fake = { places, searches, throttled: 0 } as NominatimFake;

  const handle = (req: Req): Reply => {
    if (req.method !== 'GET' || req.path !== '/search') return { status: 404, body: { error: 'not found' } };
    const ua = String(req.headers['user-agent'] ?? '');
    if (!ua || DEFAULT_AGENTS.test(ua)) return { status: 403, body: { error: 'Access blocked: identify your application in the User-Agent' } };
    const now = Date.now();
    if (now - last < minInterval) {
      fake.throttled++;
      return { status: 429, body: { error: 'Too many requests' } };
    }
    last = now;
    const format = req.query.get('format');
    if (format !== 'json' && format !== 'jsonv2') return { status: 400, body: { error: 'format must be json or jsonv2' } };
    const q = (req.query.get('q') ?? '').toLowerCase();
    searches.push({ q: req.query.get('q') ?? '', userAgent: ua, email: req.query.get('email') });
    const countries = (req.query.get('countrycodes') ?? '').toLowerCase().split(',').filter(Boolean);
    const limit = Math.max(1, Math.min(40, Number(req.query.get('limit') ?? 10) || 10));
    const found = places
      .filter((p) => p.match.toLowerCase().split(/\s+/).every((w) => q.includes(w)))
      .filter((p) => !countries.length || (p.country && countries.includes(p.country.toLowerCase())))
      .slice(0, limit);
    return { status: 200, body: found.map((p, i) => ({ place_id: i + 1, lat: p.lat.toFixed(7), lon: p.lon.toFixed(7), display_name: p.name ?? p.match, importance: 0.5 })) };
  };

  const server = await serve(handle);
  fake.url = server.url;
  fake.close = server.close;
  return fake;
}
