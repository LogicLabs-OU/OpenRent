/**
 * Verifies an `OpenRent-Signature` header: `t=<unix>,v1=<hex HMAC-SHA256 of "${t}.${rawBody}">` (PRD §6.4).
 * Pass the raw request body, not re-serialised JSON. Works in Node 18+, browsers and edge runtimes.
 */
export async function verifyWebhook(rawBody: string, header: string, secret: string, opts: { toleranceSec?: number; now?: number } = {}): Promise<boolean> {
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t)) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? 300)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return parts.filter(([k]) => k === 'v1').some(([, v]) => constantTimeEqual(v ?? '', expected));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
