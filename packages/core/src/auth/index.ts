import { t as msg } from '../i18n/index.ts';
import type { Queryable, Role } from '../context.ts';
import { AppError } from '../errors.ts';
import { newId, randomToken, sha256 } from '../ids.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { newTotpSecret, totpUri, verifyTotp } from './totp.ts';
import { PERMISSIONS } from '../permissions.ts';

export { hashPassword, verifyPassword, newTotpSecret, totpUri, verifyTotp };

/**
 * Authentication runs before a tenant is known, so these functions take a raw Queryable
 * that the caller opened with withSystem() (cross-tenant visibility, explicit and greppable).
 */

export const SESSION_TTL_DAYS = 30;

export interface SessionInfo {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  email: string;
  name: string;
  locale: string;
}

export interface Membership {
  tenant_id: string;
  role: Role;
  tenant_name: string;
  tenant_slug: string;
}

export async function findUserByEmail(db: Queryable, email: string) {
  const r = await db.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  return r.rows[0] ?? null;
}

export async function membershipsOf(db: Queryable, userId: string): Promise<Membership[]> {
  const r = await db.query<Membership>(
    `SELECT m.tenant_id, m.role, t.name AS tenant_name, t.slug AS tenant_slug
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1 ORDER BY m.created_at`,
    [userId],
  );
  return r.rows;
}

export interface LoginInput {
  email: string;
  password: string;
  totp?: string;
  ip?: string;
  userAgent?: string;
}

export async function login(db: Queryable, input: LoginInput): Promise<{ token: string; session: SessionInfo }> {
  const user = await findUserByEmail(db, input.email);
  // Verify even when the user is missing to keep timing uniform.
  const ok = await verifyPassword(user?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$1111111111111111111111', input.password);
  if (!user || !ok || user.status !== 'active') {
    throw new AppError('invalid_credentials', 401, msg('error.email_or_password_is_incorrect'));
  }
  if (user.totp_secret) {
    if (!input.totp) throw new AppError('totp_required', 401, msg('error.enter_the_code_from_your_authenticator_app'));
    if (!verifyTotp(user.totp_secret, input.totp)) throw new AppError('invalid_totp', 401, msg('error.the_authenticator_code_is_incorrect'));
  }
  return createSession(db, user, input);
}

export async function createSession(
  db: Queryable,
  user: { id: string; email: string; name: string; locale: string },
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; session: SessionInfo }> {
  const memberships = await membershipsOf(db, user.id);
  const token = randomToken(32);
  const id = newId('ses');
  const tenantId = memberships[0]?.tenant_id ?? null;
  await db.query(
    `INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6, $7)`,
    [id, user.id, tenantId, sha256(token), SESSION_TTL_DAYS, meta.ip ?? null, meta.userAgent ?? null],
  );
  return { token, session: { sessionId: id, userId: user.id, tenantId, email: user.email, name: user.name, locale: user.locale } };
}

export async function resolveSession(db: Queryable, token: string): Promise<SessionInfo | null> {
  const r = await db.query(
    `SELECT s.id AS session_id, s.tenant_id, u.id AS user_id, u.email, u.name, u.locale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
    [sha256(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { sessionId: row.session_id, userId: row.user_id, tenantId: row.tenant_id, email: row.email, name: row.name, locale: row.locale };
}

export async function revokeSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
}

export async function switchSessionTenant(db: Queryable, sessionId: string, tenantId: string): Promise<void> {
  await db.query(`UPDATE sessions SET tenant_id = $2 WHERE id = $1`, [sessionId, tenantId]);
}

// --- Magic links -----------------------------------------------------------

export async function createLoginToken(db: Queryable, email: string): Promise<{ token: string; user: any } | null> {
  const user = await findUserByEmail(db, email);
  if (!user || user.status !== 'active') return null;
  const token = randomToken(24);
  await db.query(
    `INSERT INTO login_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '15 minutes')`,
    [newId('ltk'), user.id, sha256(token)],
  );
  return { token, user };
}

export async function consumeLoginToken(db: Queryable, token: string, meta: { ip?: string; userAgent?: string }) {
  const r = await db.query(
    `UPDATE login_tokens SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(token)],
  );
  const userId = r.rows[0]?.user_id;
  if (!userId) throw new AppError('invalid_token', 401, msg('error.this_sign_in_link_is_invalid_or'));
  const user = (await db.query(`SELECT * FROM users WHERE id = $1`, [userId])).rows[0];
  return createSession(db, user, meta);
}

// --- API keys --------------------------------------------------------------

export interface ApiKeyInfo {
  id: string;
  tenantId: string;
  kind: 'secret' | 'publishable';
  scopes: string[];
}

export function generateApiKey(kind: 'secret' | 'publishable', live = true): { key: string; prefix: string; hash: string } {
  const p = kind === 'secret' ? 'sk' : 'pk';
  const key = `${p}_${live ? 'live' : 'test'}_${randomToken(24)}`;
  return { key, prefix: key.slice(0, 12), hash: sha256(key) };
}

export async function resolveApiKey(db: Queryable, key: string): Promise<ApiKeyInfo | null> {
  const r = await db.query(
    `UPDATE api_keys SET last_used_at = now()
      WHERE key_hash = $1 AND revoked_at IS NULL
      RETURNING id, tenant_id, kind, scopes`,
    [sha256(key)],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, tenantId: row.tenant_id, kind: row.kind, scopes: row.scopes };
}

export const API_KEY_SCOPES = ['*', ...PERMISSIONS] as const;
