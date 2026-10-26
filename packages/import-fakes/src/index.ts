import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-ins for the Booqable (REST v1) and Snipe-IT (v1) APIs that serve fixed records page by page
 * with each API's authentication, for testing the importers without accounts (FR-MIG-2).
 */
interface Fake {
  url: string;
  /** Requests seen, oldest first (path and query). */
  calls: string[];
  close(): Promise<void>;
}

async function serve(handle: (u: URL, headers: Record<string, string | string[] | undefined>) => { status: number; body: unknown }, calls: string[]): Promise<Fake> {
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fake');
    calls.push(`${u.pathname}${u.search}`);
    const r = handle(u, req.headers);
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise((ok) => server.close(() => ok())) };
}

export interface BooqableData {
  customers: Record<string, unknown>[];
  product_groups: Record<string, unknown>[];
  products: Record<string, unknown>[];
  /** Orders with their `lines`; the list leaves the lines out, as Booqable does, and GET /orders/{id} has them. */
  orders: (Record<string, unknown> & { id: string; lines: Record<string, unknown>[] })[];
}

export interface BooqableFake extends Fake {
  apiKey: string;
  data: BooqableData;
}

/** Booqable's REST API v1: `?api_key=` on every call, `page` and `per`, `{ <collection>: [...], meta: { total_count } }`. */
export async function startBooqableFake(data: BooqableData, apiKey = 'bq-test-key'): Promise<BooqableFake> {
  const calls: string[] = [];
  const fake = await serve((u) => {
    if (u.searchParams.get('api_key') !== apiKey) return { status: 401, body: { error: { status: 401, message: 'Unauthorized' } } };
    const m = /^\/api\/1\/(customers|product_groups|products|orders)(?:\/([^/]+))?$/.exec(u.pathname);
    if (!m) return { status: 404, body: { error: { status: 404, message: 'Not found' } } };
    const key = m[1] as keyof BooqableData;
    if (m[2]) {
      const one = (data[key] as any[]).find((r) => r.id === m[2]);
      return one ? { status: 200, body: { [key.replace(/s$/, '')]: one } } : { status: 404, body: { error: { status: 404, message: 'Not found' } } };
    }
    const page = Math.max(1, Number(u.searchParams.get('page') ?? 1));
    const per = Math.min(100, Math.max(1, Number(u.searchParams.get('per') ?? 25)));
    const all = data[key] as any[];
    const rows = all.slice((page - 1) * per, page * per).map((r) => (key === 'orders' ? { ...r, lines: undefined } : r));
    return { status: 200, body: { [key]: rows, meta: { total_count: all.length } } };
  }, calls);
  return { ...fake, apiKey, data };
}

export interface SnipeItData {
  models: Record<string, unknown>[];
  hardware: Record<string, unknown>[];
}

export interface SnipeItFake extends Fake {
  token: string;
  data: SnipeItData;
}

/**
 * Snipe-IT's API v1: `Authorization: Bearer`, `limit` (at most 500) and `offset`, `{ total, rows }`.
 * A bad token answers 200 with `{ status: 'error' }` on some versions and 401 on others: this one says 401.
 */
export async function startSnipeItFake(data: SnipeItData, token = 'snipe-test-token'): Promise<SnipeItFake> {
  const calls: string[] = [];
  const fake = await serve((u, headers) => {
    if (headers.authorization !== `Bearer ${token}`) return { status: 401, body: { status: 'error', messages: 'Unauthorized.', payload: null } };
    const m = /^\/api\/v1\/(models|hardware)$/.exec(u.pathname);
    if (!m) return { status: 404, body: { status: 'error', messages: 'Not found' } };
    const all = data[m[1] as keyof SnipeItData];
    const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit') ?? 50)));
    const offset = Math.max(0, Number(u.searchParams.get('offset') ?? 0));
    return { status: 200, body: { total: all.length, rows: all.slice(offset, offset + limit) } };
  }, calls);
  return { ...fake, token, data };
}
