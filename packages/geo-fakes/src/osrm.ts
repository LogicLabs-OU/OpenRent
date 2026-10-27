import { serve, type Req, type Reply } from './server.ts';

/**
 * OSRM's `GET /route/v1/{profile}/{lon},{lat};{lon},{lat}?overview=false`: answers
 * `{ code: 'Ok', routes: [{ distance, duration }] }` with metres and seconds, or `{ code: 'NoRoute' }`
 * when no road joins the points. The road here is the straight line times `factor`, or what `roads`
 * says for a pair of points (keyed `lon,lat;lon,lat` as in the URL, rounded to 4 places).
 */
export interface OsrmFake {
  url: string;
  roads: Record<string, number | null>;
  requests: string[];
  close(): Promise<void>;
}

const haversineM = (a: [number, number], b: [number, number]) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

export async function startOsrmFake(opts: { factor?: number; roads?: Record<string, number | null> } = {}): Promise<OsrmFake> {
  const factor = opts.factor ?? 1.25;
  const roads = { ...(opts.roads ?? {}) };
  const requests: string[] = [];

  const handle = (req: Req): Reply => {
    const m = /^\/route\/v1\/(driving|car|bike|foot)\/([^/]+)$/.exec(req.method === 'GET' ? req.path : '');
    if (!m) return { status: 400, body: { code: 'InvalidUrl', message: 'URL string malformed' } };
    const pts = decodeURIComponent(m[2]!).split(';').map((p) => p.split(',').map(Number) as [number, number]);
    if (pts.length < 2 || pts.some((p) => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) {
      return { status: 400, body: { code: 'InvalidQuery', message: 'Query string malformed' } };
    }
    requests.push(m[2]!);
    const key = pts.slice(0, 2).map((p) => p.map((x) => x.toFixed(4)).join(',')).join(';');
    const metres = key in roads ? roads[key] : haversineM(pts[0]!, pts[1]!) * factor;
    if (metres == null) return { status: 400, body: { code: 'NoRoute', message: 'Impossible route between points' } };
    return { status: 200, body: { code: 'Ok', routes: [{ distance: Math.round(metres * 10) / 10, duration: Math.round(metres / 13.9), legs: [] }], waypoints: [] } };
  };

  const server = await serve(handle);
  return { url: server.url, roads, requests, close: server.close };
}
