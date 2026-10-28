import { createHash, randomBytes } from 'node:crypto';
import type { ShopRecord } from './store.ts';

/**
 * The app as an OpenRent OAuth client (OpenRent's PRD §5.2): it registers itself with each OpenRent it meets
 * (a public client, so PKCE proves it), and keeps one grant per Shopify shop.
 */
export const SCOPES = 'tenant:read tenant:write catalog:read';

const b64url = (b: Buffer) => b.toString('base64url');

export function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

/** An OpenRent address as typed: https, or http on this machine (development). */
export function cleanApiUrl(raw: unknown) {
  try {
    const u = new URL(String(raw ?? '').trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return null;
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

async function json(res: Response) {
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description ?? body.detail ?? body.error ?? `OpenRent answered ${res.status}`);
  return body;
}

export async function register(apiUrl: string, name: string, redirect: string, homepage: string) {
  const r = await json(await fetch(`${apiUrl}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect], client_uri: homepage }), signal: AbortSignal.timeout(15_000) }));
  return r.client_id as string;
}

export function authorizeUrl(apiUrl: string, clientId: string, redirect: string, state: string, challenge: string) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `${apiUrl}/oauth/authorize?${q}`;
}

export async function token(apiUrl: string, form: Record<string, string>) {
  return json(await fetch(`${apiUrl}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15_000) })) as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

export async function revoke(apiUrl: string, clientId: string, tokenValue: string) {
  await fetch(`${apiUrl}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokenValue, client_id: clientId }), signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
}

/** A valid access token for the shop: the stored one, or a new one (refresh tokens work once). */
export async function accessToken(record: ShopRecord, save: (r: ShopRecord) => Promise<void>) {
  const o = record.openrent;
  if (!o?.refreshToken) throw new Error('not connected to OpenRent');
  if (o.accessToken && (o.expiresAt ?? 0) > Date.now() + 60_000) return o.accessToken;
  const t = await token(o.apiUrl, { grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: o.clientId });
  record.openrent = { ...o, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 };
  await save(record);
  return t.access_token;
}

export async function api(record: ShopRecord, save: (r: ShopRecord) => Promise<void>, method: string, path: string, body?: unknown) {
  const t = await accessToken(record, save);
  return json(
    await fetch(`${record.openrent!.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${t}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }),
  );
}
