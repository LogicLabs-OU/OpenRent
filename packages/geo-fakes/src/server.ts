import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  raw: string;
}
export interface Reply {
  status: number;
  body?: unknown;
}

/** A tiny JSON HTTP server on a free local port. */
export async function serve(handle: (req: Req) => Reply | Promise<Reply>): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer(async (r, res) => {
    let raw = '';
    for await (const c of r) raw += c;
    const u = new URL(r.url ?? '/', 'http://fake');
    const reply = await Promise.resolve(handle({ method: r.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: r.headers, raw })).catch((e: Error) => ({ status: 500, body: { message: e.message } }));
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((ok) => server.close(() => ok())) };
}
