import { createHash, timingSafeEqual } from 'node:crypto';
import type { Ctx, Queryable } from '../context.ts';
import { AppError } from '../errors.ts';
import { audit } from '../events.ts';
import { newId, randomToken, sha256 } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, one } from '../sql.ts';
import { PERMISSIONS, permissionsFor, type Permission } from '../permissions.ts';

/**
 * OAuth 2.1 for third-party apps (PRD §5.2): the authorization code flow with PKCE (S256 only), short
 * access tokens and rotating refresh tokens. A refresh token used twice means it leaked: the whole grant
 * ends. Apps register themselves (RFC 7591, public clients) or the operator registers them with a secret.
 * A shop's owner or admin consents for their shop; the app gets at most the scopes that person has.
 */
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_DAYS = 60;
const CODE_TTL_MS = 10 * 60_000;

/** OAuth's own errors are answered as RFC 6749 says: `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    readonly error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type' | 'invalid_scope' | 'access_denied' | 'invalid_redirect_uri' | 'invalid_client_metadata',
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export const SCOPES: readonly string[] = PERMISSIONS;

export function parseScopes(raw: unknown): string[] {
  return [...new Set(String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

// --- Clients ---------------------------------------------------------------------------------------------

export interface OAuthClient {
  id: string;
  name: string;
  redirect_uris: string[];
  confidential: boolean;
  homepage: string | null;
  created_via: string;
}

const clientToApi = (r: any): OAuthClient => ({ id: r.id, name: r.name, redirect_uris: r.redirect_uris, confidential: !!r.secret_hash, homepage: r.homepage, created_via: r.created_via });

/** https, or http on this machine only (apps under development); no fragments. */
function goodRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** RFC 7591: an app registers itself as a public client (it proves itself with PKCE on each sign-in). */
export async function registerClient(db: Queryable, input: { client_name?: unknown; redirect_uris?: unknown; client_uri?: unknown; token_endpoint_auth_method?: unknown }, opts: { confidential?: boolean; via?: 'dynamic' | 'operator' } = {}) {
  const name = String(input.client_name ?? '').trim().slice(0, 100);
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (!name) throw new OAuthError('invalid_client_metadata', 'client_name is required');
  if (!uris.length || uris.length > 10 || !uris.every(goodRedirect)) throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1 to 10 https addresses (http only on localhost), without fragments');
  const method = String(input.token_endpoint_auth_method ?? (opts.confidential ? 'client_secret_basic' : 'none'));
  if (!opts.confidential && method !== 'none') throw new OAuthError('invalid_client_metadata', 'apps that register themselves are public clients: token_endpoint_auth_method none');
  const homepage = typeof input.client_uri === 'string' && /^https?:\/\//.test(input.client_uri) ? input.client_uri.slice(0, 500) : null;
  const id = `oac_${randomToken(16)}`;
  const secret = opts.confidential ? `ocs_${randomToken(32)}` : null;
  await db.query(`INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, homepage, created_via) VALUES ($1,$2,$3,$4,$5,$6)`, [id, name, uris, secret ? sha256(secret) : null, homepage, opts.via ?? 'dynamic']);
  return {
    client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: secret ? method : 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

export async function getClient(db: Queryable, id: string): Promise<(OAuthClient & { secret_hash: string | null }) | null> {
  const r = (await db.query(`SELECT * FROM oauth_clients WHERE id = $1 AND disabled_at IS NULL`, [id])).rows[0];
  return r ? { ...clientToApi(r), secret_hash: r.secret_hash } : null;
}

/** A confidential client proves itself with its secret (HTTP Basic or in the form); a public one sends none. */
export function authenticateClient(client: { secret_hash: string | null }, secret: string | null) {
  if (!client.secret_hash) {
    if (secret) throw new OAuthError('invalid_client', 'this client has no secret', 401);
    return;
  }
  const want = Buffer.from(client.secret_hash);
  const got = Buffer.from(secret ? sha256(secret) : '');
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new OAuthError('invalid_client', 'client authentication failed', 401);
}

// --- Authorization ---------------------------------------------------------------------------------------

export interface AuthorizeRequest {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

/**
 * Checks an authorization request. Problems with the client or its redirect address are shown on our own
 * page (we may not send the person to an address we cannot vouch for); anything else goes back to the app.
 */
export async function checkAuthorize(db: Queryable, q: AuthorizeRequest) {
  const client = q.client_id ? await getClient(db, q.client_id) : null;
  if (!client) return { fatal: msg('oauth.unknown_client') };
  const redirect = q.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
  if (!redirect || !client.redirect_uris.includes(redirect)) return { fatal: msg('oauth.bad_redirect') };
  const back = (error: string, description: string) => ({ client, redirect, error: { error, error_description: description } });
  if (q.response_type !== 'code') return back('unsupported_response_type', 'response_type must be code');
  if (!q.code_challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return back('invalid_request', 'PKCE is required: send code_challenge (S256)');
  if ((q.code_challenge_method ?? 'plain') !== 'S256') return back('invalid_request', 'code_challenge_method must be S256');
  const scopes = parseScopes(q.scope);
  const unknown = scopes.filter((s) => !SCOPES.includes(s));
  if (!scopes.length || unknown.length) return back('invalid_scope', unknown.length ? `unknown scopes: ${unknown.join(' ')}` : 'ask for at least one scope');
  return { client, redirect, scopes };
}

/** The person said yes for their shop: a one-time code for the scopes they themselves have. */
export async function approve(ctx: Ctx, q: AuthorizeRequest) {
  const checked: any = await checkAuthorize(ctx.db, q);
  if (checked.fatal) throw new AppError('invalid_oauth_request', 422, checked.fatal);
  if (checked.error) return { redirect_to: withParams(checked.redirect, { ...checked.error, state: q.state }) };
  const mine = permissionsFor(ctx.actor);
  const granted = (checked.scopes as string[]).filter((s) => mine.includes('*') || mine.includes(s as Permission));
  if (!granted.length) return { redirect_to: withParams(checked.redirect, { error: 'invalid_scope', error_description: 'the person who approved has none of these permissions', state: q.state }) };
  const code = `occ_${randomToken(32)}`;
  await exec(ctx, `INSERT INTO oauth_codes (id, tenant_id, client_id, user_id, code_hash, redirect_uri, scopes, code_challenge, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    newId('oco'), ctx.tenantId, checked.client.id, ctx.actor.id, sha256(code), checked.redirect, granted, q.code_challenge, new Date(ctx.now.getTime() + CODE_TTL_MS),
  ]);
  return { redirect_to: withParams(checked.redirect, { code, state: q.state }), scopes: granted };
}

export async function deny(db: Queryable, q: AuthorizeRequest) {
  const checked: any = await checkAuthorize(db, q);
  if (checked.fatal) throw new AppError('invalid_oauth_request', 422, checked.fatal);
  return { redirect_to: withParams(checked.redirect, { error: 'access_denied', error_description: 'the person declined', state: q.state }) };
}

export function withParams(uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

// --- Tokens ----------------------------------------------------------------------------------------------

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

async function issue(db: Queryable, grant: { id: string; tenant_id: string; scopes: string[] }, family: string, now: Date) {
  const access = `oat_${randomToken(32)}`;
  const refresh = `ort_${randomToken(32)}`;
  await db.query(
    `INSERT INTO oauth_tokens (id, tenant_id, grant_id, kind, token_hash, family_id, expires_at) VALUES ($1,$2,$3,'access',$4,$5,$6), ($7,$2,$3,'refresh',$8,$5,$9)`,
    [newId('otk'), grant.tenant_id, grant.id, sha256(access), family, new Date(now.getTime() + ACCESS_TTL_S * 1000), newId('otk'), sha256(refresh), new Date(now.getTime() + REFRESH_TTL_DAYS * 86_400_000)],
  );
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: grant.scopes.join(' ') };
}

/** POST /oauth/token. Runs as the system: the token, not a session, says which shop. */
export async function token(db: Queryable, body: Record<string, string | undefined>, clientAuth: { id: string | null; secret: string | null }, now = new Date()) {
  const clientId = clientAuth.id ?? body.client_id ?? null;
  const client = clientId ? await getClient(db, clientId) : null;
  if (!client) throw new OAuthError('invalid_client', 'unknown client', 401);
  authenticateClient(client, clientAuth.secret ?? body.client_secret ?? null);

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.code_verifier) throw new OAuthError('invalid_request', 'code and code_verifier are required');
    const c = (await db.query(`UPDATE oauth_codes SET used_at = $2 WHERE code_hash = $1 AND used_at IS NULL RETURNING *`, [sha256(body.code), now])).rows[0];
    if (!c) {
      // A code sent twice may have been stolen: what the first use gave is taken back.
      const used = (await db.query(`SELECT grant_id FROM oauth_codes WHERE code_hash = $1`, [sha256(body.code)])).rows[0];
      if (used?.grant_id) await revokeGrant(db, used.grant_id, now);
      throw new OAuthError('invalid_grant', 'the code is unknown or used');
    }
    if (c.client_id !== client.id || new Date(c.expires_at) <= now) throw new OAuthError('invalid_grant', 'the code is not for this client or has expired');
    if ((body.redirect_uri ?? c.redirect_uri) !== c.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri differs from the authorization request');
    if (s256(body.code_verifier) !== c.code_challenge) throw new OAuthError('invalid_grant', 'code_verifier does not match the code_challenge');
    // One grant per shop and app: approving again replaces the scopes.
    const grant = (
      await db.query(
        `INSERT INTO oauth_grants (id, tenant_id, client_id, user_id, scopes) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, client_id) WHERE revoked_at IS NULL DO UPDATE SET scopes = EXCLUDED.scopes, user_id = EXCLUDED.user_id, updated_at = now() RETURNING *`,
        [newId('ogr'), c.tenant_id, client.id, c.user_id, c.scopes],
      )
    ).rows[0];
    await db.query(`UPDATE oauth_codes SET grant_id = $2 WHERE id = $1`, [c.id, grant.id]);
    return issue(db, grant, newId('otf'), now);
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required');
    const t = (await db.query(`SELECT t.*, g.client_id, g.scopes, g.revoked_at AS grant_revoked FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = $1 AND t.kind = 'refresh'`, [sha256(body.refresh_token)])).rows[0];
    if (!t || t.client_id !== client.id) throw new OAuthError('invalid_grant', 'unknown refresh token');
    if (t.used_at || t.revoked_at || t.grant_revoked) {
      // Used twice: someone else has it. Everything of this grant stops.
      if (t.used_at) await revokeGrant(db, t.grant_id, now);
      throw new OAuthError('invalid_grant', 'the refresh token was already used or revoked');
    }
    if (new Date(t.expires_at) <= now) throw new OAuthError('invalid_grant', 'the refresh token has expired');
    const done = (await db.query(`UPDATE oauth_tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL RETURNING id`, [t.id, now])).rows[0];
    if (!done) throw new OAuthError('invalid_grant', 'the refresh token was already used');
    // A narrower scope may be asked for; never a wider one.
    const asked = body.scope ? parseScopes(body.scope) : t.scopes;
    if (asked.some((s: string) => !t.scopes.includes(s))) throw new OAuthError('invalid_scope', 'scope wider than granted');
    await db.query(`UPDATE oauth_tokens SET revoked_at = $2 WHERE family_id = $1 AND kind = 'access' AND revoked_at IS NULL`, [t.family_id, now]);
    return issue(db, { id: t.grant_id, tenant_id: t.tenant_id, scopes: asked }, t.family_id, now);
  }
  throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

/** RFC 7009: a token is revoked (a refresh token takes its grant's tokens with it); unknown ones are fine. */
export async function revokeToken(db: Queryable, raw: string, clientId: string | null, now = new Date()) {
  const t = (await db.query(`SELECT t.id, t.kind, t.grant_id, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = $1`, [sha256(raw)])).rows[0];
  if (!t || (clientId && t.client_id !== clientId)) return;
  if (t.kind === 'refresh') await revokeGrant(db, t.grant_id, now);
  else await db.query(`UPDATE oauth_tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [t.id, now]);
}

async function revokeGrant(db: Queryable, grantId: string, now: Date) {
  await db.query(`UPDATE oauth_grants SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [grantId, now]);
  await db.query(`UPDATE oauth_tokens SET revoked_at = $2 WHERE grant_id = $1 AND revoked_at IS NULL`, [grantId, now]);
}

/** An access token in a request: the shop, the grant and its scopes, or null. */
export async function resolveAccessToken(db: Queryable, raw: string, now = new Date()) {
  const r = (
    await db.query(
      `UPDATE oauth_grants g SET last_used_at = $2 FROM oauth_tokens t
        WHERE t.token_hash = $1 AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > $2 AND g.id = t.grant_id AND g.revoked_at IS NULL
        RETURNING g.id, g.tenant_id, g.scopes, g.client_id`,
      [sha256(raw), now],
    )
  ).rows[0];
  return r ? { grantId: r.id as string, tenantId: r.tenant_id as string, scopes: r.scopes as string[], clientId: r.client_id as string } : null;
}

// --- The shop's connected apps ---------------------------------------------------------------------------

export function grantToApi(r: any) {
  return { id: r.id, object: 'oauth_grant', client_id: r.client_id, app_name: r.app_name, homepage: r.homepage, scopes: r.scopes, approved_by: r.approved_by ?? null, created_at: r.created_at, last_used_at: r.last_used_at };
}

export async function listGrants(ctx: Ctx) {
  return (
    await many(
      ctx,
      `SELECT g.*, c.name AS app_name, c.homepage, u.name AS approved_by FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id LEFT JOIN users u ON u.id = g.user_id
        WHERE g.revoked_at IS NULL ORDER BY c.name`,
    )
  ).map(grantToApi);
}

export async function disconnect(ctx: Ctx, id: string) {
  const g = await one(ctx, `SELECT g.*, c.name AS app_name FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id WHERE g.id = $1 AND g.revoked_at IS NULL`, [id]);
  if (!g) throw new AppError('not_found', 404, msg('oauth.grant_not_found'));
  await revokeGrant(ctx.db, id, ctx.now);
  await audit(ctx, { entity_type: 'oauth_grant', entity_id: id, action: 'revoke', extra: { app: g.app_name } });
  return { ...grantToApi(g), deleted: true };
}

/** The authorization server's metadata (RFC 8414). */
export function metadata(issuer: string) {
  const base = issuer.replace(/\/$/, '');
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: SCOPES,
    service_documentation: 'https://openrent.dev/docs/guide/api#oauth',
  };
}
