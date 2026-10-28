import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request as the fakes see it: the raw bytes and, for JSON, the parsed body. */
export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  bytes: Buffer;
  body: any;
}
export interface Reply {
  status: number;
  body?: unknown;
  /** Bytes sent as they are, with `type`. */
  raw?: { type: string; data: Buffer };
}

export interface Server {
  url: string;
  close(): Promise<void>;
  calls: { method: string; path: string }[];
}

/** A small HTTP server answering with `handle`; errors become 500 with their message. */
export async function serve(handle: (req: Req) => Reply | Promise<Reply>): Promise<Server> {
  const calls: Server['calls'] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'http://fake');
    let body: any = null;
    if (String(req.headers['content-type'] ?? '').includes('application/json') && bytes.length) {
      try {
        body = JSON.parse(bytes.toString('utf8'));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'invalid JSON' }));
        return;
      }
    } else if (String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(bytes.toString('utf8')));
    calls.push({ method: req.method ?? 'GET', path: url.pathname });
    try {
      const r = await handle({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers, bytes, body });
      if (r.raw) res.writeHead(r.status, { 'content-type': r.raw.type }).end(r.raw.data);
      else res.writeHead(r.status, { 'content-type': 'application/json' }).end(r.body === undefined ? '' : JSON.stringify(r.body));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ message: (err as Error).message }));
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

/** The parts of a multipart/form-data body: name, file name and bytes. */
export function multipart(req: Req): { name: string; filename: string | null; type: string | null; data: Buffer }[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(String(req.headers['content-type'] ?? ''));
  if (!m) return [];
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const out: { name: string; filename: string | null; type: string | null; data: Buffer }[] = [];
  let at = req.bytes.indexOf(boundary);
  while (at >= 0) {
    const next = req.bytes.indexOf(boundary, at + boundary.length);
    if (next < 0) break;
    const part = req.bytes.subarray(at + boundary.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('utf8');
    const name = /name="([^"]+)"/.exec(head)?.[1] ?? '';
    out.push({ name, filename: /filename="([^"]*)"/.exec(head)?.[1] ?? null, type: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? null, data: part.subarray(split + 4) });
    at = next;
  }
  return out;
}

export const isPdf = (b: Buffer | Uint8Array) => Buffer.from(b).subarray(0, 5).toString('latin1') === '%PDF-';
