import { createHmac, timingSafeEqual } from 'node:crypto';

/** `OpenRent-Signature: t=<unix>,v1=<hex>[,v1=<hex>]` over `${t}.${rawBody}` (PRD §6.4). */
export function signatureHeader(secrets: string[], timestamp: number, rawBody: string): string {
  const parts = [`t=${timestamp}`];
  for (const s of secrets) parts.push(`v1=${createHmac('sha256', s).update(`${timestamp}.${rawBody}`).digest('hex')}`);
  return parts.join(',');
}

export function verifySignature(rawBody: string, header: string, secret: string, opts: { toleranceSec?: number; now?: number } = {}): boolean {
  const items = header.split(',').map((p) => p.trim().split('='));
  const t = Number(items.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t)) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? 300)) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  return items
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const got = Buffer.from(v ?? '');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}

/** Retry schedule in minutes: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, 24 h (PRD §6.5). */
export const RETRY_MINUTES = [1, 5, 30, 120, 360, 720, 1440, 1440];

export function nextAttemptDelayMs(attempt: number, rand = Math.random): number | null {
  const base = RETRY_MINUTES[attempt - 1];
  if (base === undefined) return null;
  const jitter = 1 + (rand() - 0.5) * 0.2; // ±10%
  return Math.round(base * 60_000 * jitter);
}

/** Literal private, loopback and link-local addresses (SSRF guard for webhook URLs). */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::';
  return false;
}
