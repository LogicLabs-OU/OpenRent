import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request as the fakes see it: JSON or form bodies parsed, the raw text kept. */
export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  raw: string;
  body: any;
}

export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): FakeReply => ({ status, body, headers });

export interface FakeHttp {
  url: string;
  close(): Promise<void>;
  /** Calls the provider API saw (control calls excluded), oldest first. */
  calls: { method: string; path: string; body: any }[];
}

/** An HTTP server for a fake provider API; `/__fake/...` paths are test controls and not recorded. */
export async function serve(handle: (req: FakeRequest) => FakeReply | Promise<FakeReply>): Promise<FakeHttp> {
  const calls: FakeHttp['calls'] = [];
  const server: Server = createServer(async (r: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const chunk of r) raw += chunk;
    const u = new URL(r.url ?? '/', 'http://fake');
    const type = String(r.headers['content-type'] ?? '');
    let body: any;
    try {
      body = !raw ? undefined : type.includes('json') ? JSON.parse(raw) : type.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : raw;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'malformed body' }));
      return;
    }
    const req: FakeRequest = { method: r.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: r.headers, raw, body };
    if (!u.pathname.startsWith('/__fake/')) calls.push({ method: req.method, path: `${u.pathname}${u.search}`, body });
    const reply = await Promise.resolve(handle(req)).catch((e: Error) => json(500, { error: e.message }));
    res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
    res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((ok) => server.close(() => ok())), calls };
}

/** Decimal places of a currency, as the providers expect amounts written. */
export const decimals = (currency: string) => (['JPY', 'KRW', 'ISK', 'HUF', 'TWD'].includes(currency.toUpperCase()) ? 0 : 2);

/** A provider amount string ("10.00", "1000" for JPY) to minor units; null when written wrong. */
export function minorOf(value: unknown, currency: string): number | null {
  const d = decimals(currency);
  const re = d ? new RegExp(`^\\d+\\.\\d{${d}}$`) : /^\d+$/;
  if (typeof value !== 'string' || !re.test(value)) return null;
  return Math.round(Number(value) * 10 ** d);
}

export const majorOf = (minor: number, currency: string) => (minor / 10 ** decimals(currency)).toFixed(decimals(currency));

let seq = 0;
export const nextId = (prefix: string) => `${prefix}${(++seq).toString(36).padStart(6, '0')}${Math.random().toString(36).slice(2, 6)}`;
