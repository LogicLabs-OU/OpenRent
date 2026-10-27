import { t as msg } from '../i18n/index.ts';
import type { Queryable, Role } from '../context.ts';
import { AppError, invalid } from '../errors.ts';
import { newId, randomToken, sha256 } from '../ids.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { newTotpSecret, totpStep, totpUri, verifyTotp } from './totp.ts';
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
  /** The custom role's id, name and permissions (role 'custom'). */
  role_id: string | null;
  role_name: string | null;
  permissions: string[] | null;
  tenant_name: string;
  tenant_slug: string;
}

export async function findUserByEmail(db: Queryable, email: string) {
  const r = await db.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  return r.rows[0] ?? null;
}

export async function membershipsOf(db: Queryable, userId: string): Promise<Membership[]> {
  const r = await db.query<Membership>(
    `SELECT m.tenant_id, m.role, m.role_id, r.name AS role_name, r.permissions, t.name AS tenant_name, t.slug AS tenant_slug
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id LEFT JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = $1 AND m.disabled_at IS NULL ORDER BY m.created_at`,
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

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(randomToken(16)));

export async function login(db: Queryable, input: LoginInput): Promise<{ token: string; session: SessionInfo }> {
  const user = await findUserByEmail(db, input.email);
  // Verify even when the user is missing, against a real hash, so both take as long.
  const ok = await verifyPassword(user?.password_hash ?? (await dummyHash()), input.password);
  if (!user || !ok || user.status !== 'active') {
    throw new AppError('invalid_credentials', 401, msg('error.email_or_password_is_incorrect'));
  }
  const { assertNoSsoRequired } = await import('../sso/index.ts');
  await assertNoSsoRequired(db, user.email);
  if (user.totp_secret) {
    if (!input.totp) throw new AppError('totp_required', 401, msg('error.enter_the_code_from_your_authenticator_app'));
    // Each code works once: a code seen over someone's shoulder is spent.
    const step = totpStep(user.totp_secret, input.totp);
    if (step === null || (user.totp_last_step != null && step <= Number(user.totp_last_step))) throw new AppError('invalid_totp', 401, msg('error.the_authenticator_code_is_incorrect'));
    await db.query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [user.id, step]);
  }
  return createSession(db, user, input);
}

export async function createSession(
  db: Queryable,
  user: { id: string; email: string; name: string; locale: string },
  meta: { ip?: string; userAgent?: string },
  /** The shop to open (single sign-on); otherwise the first the user belongs to. */
  preferTenantId?: string | null,
): Promise<{ token: string; session: SessionInfo }> {
  const memberships = await membershipsOf(db, user.id);
  const token = randomToken(32);
  const id = newId('ses');
  const tenantId = (preferTenantId && memberships.find((m) => m.tenant_id === preferTenantId)?.tenant_id) ?? memberships[0]?.tenant_id ?? null;
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

/** A one-time sign-in link: 15 minutes when asked for at the login page, longer for an invitation. */
export async function createLoginToken(db: Queryable, email: string, ttlMinutes = 15): Promise<{ token: string; user: any } | null> {
  const user = await findUserByEmail(db, email);
  if (!user || user.status !== 'active') return null;
  // People who must use single sign-on get no emailed link either.
  const { assertNoSsoRequired } = await import('../sso/index.ts');
  if (await assertNoSsoRequired(db, user.email).then(() => false, () => true)) return null;
  const token = randomToken(24);
  await db.query(
    `INSERT INTO login_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [newId('ltk'), user.id, sha256(token), ttlMinutes],
  );
  return { token, user };
}

/**
 * Exchanges a sign-in link for a session. Someone with an authenticator app also gives its code: the
 * link alone is only one factor. The link stays valid until the code is right (or it expires).
 */
export async function consumeLoginToken(db: Queryable, token: string, meta: { ip?: string; userAgent?: string }, totp?: string) {
  const row = (await db.query(`SELECT user_id FROM login_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [sha256(token)])).rows[0];
  if (!row) throw new AppError('invalid_token', 401, msg('error.this_sign_in_link_is_invalid_or'));
  const user = (await db.query(`SELECT * FROM users WHERE id = $1`, [row.user_id])).rows[0];
  if (!user || user.status !== 'active') throw new AppError('invalid_token', 401, msg('error.this_sign_in_link_is_invalid_or'));
  const { assertNoSsoRequired } = await import('../sso/index.ts');
  await assertNoSsoRequired(db, user.email);
  if (user.totp_secret) {
    if (!totp) throw new AppError('totp_required', 401, msg('error.enter_the_code_from_your_authenticator_app'));
    const step = totpStep(user.totp_secret, totp);
    if (step === null || (user.totp_last_step != null && step <= Number(user.totp_last_step))) throw new AppError('invalid_totp', 401, msg('error.the_authenticator_code_is_incorrect'));
    await db.query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [user.id, step]);
  }
  const used = await db.query(`UPDATE login_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING 1`, [sha256(token)]);
  if (!used.rowCount) throw new AppError('invalid_token', 401, msg('error.this_sign_in_link_is_invalid_or'));
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

/**
 * Sets the signed-in user's password. With a password already set the current one is needed; after an
 * invitation or a reset (no password) the sign-in link was the proof. Other sessions end.
 */
export async function setOwnPassword(db: Queryable, userId: string, sessionId: string | null, input: { password: string; current_password?: string }) {
  const user = (await db.query(`SELECT id, password_hash FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user) throw new AppError('unauthorized', 401, msg('auth.not_signed_in'));
  const errors = [];
  if (user.password_hash && !(await verifyPassword(user.password_hash, input.current_password ?? '')))
    errors.push({ field: 'current_password', code: 'invalid', message: msg('error.field.wrong_password') });
  if ((input.password ?? '').length < 8) errors.push({ field: 'password', code: 'too_short', message: msg('error.field.use_at_least_8_characters') });
  if (errors.length) throw invalid(msg('error.check_the_password'), errors);
  await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, await hashPassword(input.password)]);
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id IS DISTINCT FROM $2 AND revoked_at IS NULL`, [userId, sessionId]);
  return { object: 'result', password_set: true };
}
