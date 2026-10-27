import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

/**
 * Slack incoming webhooks: `POST /services/T…/B…/{secret}` with JSON `{ text, blocks? }`. As Slack
 * does, the answer is plain text: `ok`, or an error code with its status (`invalid_payload` 400,
 * `no_text` 400, `invalid_token` 403, `no_service` 404, `channel_is_archived` 410). More than one
 * message a second gets 429 with Retry-After. `text` may be at most 40 000 characters.
 */
export interface SlackMessage {
  text: string;
  blocks: unknown[] | null;
}

export interface SlackFake {
  url: string;
  /** The webhook URL a workspace would hand out. */
  webhookUrl: string;
  messages: SlackMessage[];
  /** Makes the channel archived, as if someone archived it in Slack. */
  archive(): void;
  close(): Promise<void>;
}

export async function startSlackFake(opts: { minIntervalMs?: number } = {}): Promise<SlackFake> {
  const path = `/services/T${randomBytes(4).toString('hex').toUpperCase()}/B${randomBytes(4).toString('hex').toUpperCase()}/${randomBytes(12).toString('hex')}`;
  const messages: SlackMessage[] = [];
  const minInterval = opts.minIntervalMs ?? 0;
  let archived = false;
  let last = 0;
  const server: Server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const reply = (status: number, text: string, headers: Record<string, string> = {}) => res.writeHead(status, { 'content-type': 'text/plain', ...headers }).end(text);
    if (req.method !== 'POST' || !req.url?.startsWith('/services/')) return reply(404, 'no_service');
    if (req.url !== path) return reply(403, 'invalid_token');
    if (archived) return reply(410, 'channel_is_archived');
    if (Date.now() - last < minInterval) return reply(429, 'rate_limited', { 'retry-after': '1' });
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, 'invalid_payload');
    }
    if (typeof body?.text !== 'string' || !body.text.trim()) return reply(400, 'no_text');
    if (body.text.length > 40_000 || (body.blocks !== undefined && !Array.isArray(body.blocks))) return reply(400, 'invalid_payload');
    last = Date.now();
    messages.push({ text: body.text, blocks: body.blocks ?? null });
    reply(200, 'ok');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, webhookUrl: `${url}${path}`, messages, archive: () => (archived = true), close: () => new Promise((ok) => server.close(() => ok())) };
}
