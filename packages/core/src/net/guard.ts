import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

/**
 * Outbound requests to addresses a shop or a customer chose (webhooks, import sources, plugin
 * endpoints, images in documents) must not reach the installation's own network: loopback, private
 * and link-local ranges (cloud metadata at 169.254.169.254), and other special-purpose addresses.
 *
 * The check happens when connecting, for every connection: after DNS (so a public name pointing at a
 * private address is refused), on each redirect hop, and against the very address connected to (so a
 * second DNS answer cannot swap it). Hosts the operator lists in `OPENRENT_OUTBOUND_ALLOW` (its own
 * services, e.g. `meilisearch:7700`) are let through.
 */
// Two lists: Node's BlockList matches IPv4 addresses against IPv4-mapped IPv6 rules, so one list
// with ::ffff:0:0/96 would refuse every IPv4 address. Mapped addresses are checked as IPv4 instead.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
const V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const V6: [string, number][] = [
  ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];
for (const [a, p] of V4) blocked4.addSubnet(a, p, 'ipv4');
for (const [a, p] of V6) blocked6.addSubnet(a, p, 'ipv6');

/** IPv4 inside IPv6: mapped (::ffff:a.b.c.d or ::ffff:7f00:1) and NAT64 (64:ff9b::a.b.c.d). */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2]!, 16);
  const lo = parseInt(m[3]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blocked4.check(ip, 'ipv4');
  if (kind !== 6) return true;
  const v4 = embeddedV4(ip.toLowerCase());
  if (v4) return blocked4.check(v4, 'ipv4') || /^::ffff:/i.test(ip);
  return blocked6.check(ip, 'ipv6');
}

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`${host} is on a private or reserved network; requests there are not allowed`);
    this.name = 'BlockedAddressError';
  }
}

const allowed = new Set(
  (process.env.OPENRENT_OUTBOUND_ALLOW ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const isAllowed = (host: string, port: string | number | undefined) => allowed.has(host) || (port ? allowed.has(`${host}:${port}`) : false);

const connector = buildConnector({ timeout: 10_000 });
const SPECIAL = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/;

const guardedConnect: buildConnector.connector = (opts, cb) => {
  const host = opts.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isAllowed(host, opts.port)) return connector(opts, cb);
  if (SPECIAL.test(host)) return cb(new BlockedAddressError(host), null);
  if (isIP(host)) return isBlockedAddress(host) ? cb(new BlockedAddressError(host), null) : connector(opts, cb);
  lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err, null);
    const list = addrs ?? [];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) return cb(new BlockedAddressError(host), null);
    // Connect to the address that was checked; TLS still verifies the certificate for the name.
    connector({ ...opts, hostname: list[0]!.address, servername: opts.servername || host }, cb);
  });
};

/** An HTTP agent whose every connection goes through the check. */
export const guardedAgent = new Agent({ connect: guardedConnect });

export interface GuardedInit extends RequestInit {
  /** Default 15 s. */
  timeoutMs?: number;
}

/** `fetch` for addresses someone else chose: http(s) only, checked on every connection and redirect. */
export async function guardedFetch(url: string | URL, init: GuardedInit = {}): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new BlockedAddressError(u.protocol);
  const { timeoutMs, ...rest } = init;
  const signal = rest.signal ?? AbortSignal.timeout(timeoutMs ?? 15_000);
  return (await undiciFetch(u, { ...(rest as any), signal, dispatcher: guardedAgent })) as unknown as Response;
}

/** A response body as text, at most `maxBytes` (the rest is dropped), so a huge answer cannot fill memory. */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

/**
 * On a multi-shop installation every `fetch` in the process (plugins included) goes through the
 * check, so no shop's setting can make the server call into the operator's network.
 */
export function guardAllFetches() {
  const original = globalThis.fetch;
  if ((original as any).__openrentGuarded) return;
  const guarded = ((input: any, init?: any) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input?.url;
    return guardedFetch(url, { ...(input instanceof Request ? { method: input.method, headers: input.headers, body: input.body, duplex: 'half' } : {}), ...(init ?? {}) } as GuardedInit);
  }) as typeof fetch;
  (guarded as any).__openrentGuarded = true;
  globalThis.fetch = guarded;
}
