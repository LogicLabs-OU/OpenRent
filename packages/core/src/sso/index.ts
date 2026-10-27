import type { Ctx, Queryable, Role } from '../context.ts';
import { SYSTEM_ROLES } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, many, must, one } from '../sql.ts';
import { createSession } from '../auth/index.ts';

/**
 * Single sign-on for staff with OpenID Connect (FR-USR-4). Each shop adds providers (issuer, client,
 * the email domains they vouch for). Someone from an allowed domain whose email the provider has
 * verified signs in; the first time they join the shop with the provider's default role. With
 * `enforce_sso`, people of those domains cannot use a password or an emailed link any more.
 * The protocol itself (discovery, PKCE, tokens) runs in the API.
 */
export interface ProviderInput {
  name?: string;
  issuer?: string;
  client_id?: string;
  client_secret?: string | null;
  allowed_domains?: string[];
  default_role?: string;
  enforce_sso?: boolean;
  active?: boolean;
}

export function providerToApi(r: any) {
  return {
    id: r.id, object: 'sso_provider', name: r.name, issuer: r.issuer, client_id: r.client_id, has_client_secret: !!r.client_secret_encrypted,
    allowed_domains: r.allowed_domains ?? [], default_role: r.default_role, enforce_sso: r.enforce_sso, active: r.active, created_at: r.created_at, updated_at: r.updated_at,
  };
}

const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';
const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^@/, '');

async function check(ctx: Ctx, input: ProviderInput, partial: boolean) {
  const errors: FieldError[] = [];
  if ((!partial || input.name !== undefined) && !input.name?.trim()) errors.push({ field: 'name', code: 'required', message: msg('error.field.enter_a_name') });
  if (!partial || input.issuer !== undefined) {
    let ok: boolean;
    try {
      const u = new URL(input.issuer ?? '');
      ok = u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    } catch {
      ok = false;
    }
    if (!ok) errors.push({ field: 'issuer', code: 'invalid', message: msg('error.field.use_an_https_url') });
  }
  if ((!partial || input.client_id !== undefined) && !input.client_id?.trim()) errors.push({ field: 'client_id', code: 'required', message: msg('error.field.sso_client_id') });
  if (!partial || input.allowed_domains !== undefined) {
    const ds = (input.allowed_domains ?? []).map(cleanDomain).filter(Boolean);
    if (!ds.length) errors.push({ field: 'allowed_domains', code: 'required', message: msg('error.field.sso_domains') });
    ds.forEach((d, i) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && errors.push({ field: `allowed_domains[${i}]`, code: 'invalid', message: msg('error.field.sso_domain', { domain: d }) }));
  }
  if (input.default_role !== undefined && !(SYSTEM_ROLES as readonly string[]).includes(input.default_role) && !(await one(ctx, `SELECT 1 FROM roles WHERE id = $1 AND deleted_at IS NULL`, [input.default_role])))
    errors.push({ field: 'default_role', code: 'not_found', message: msg('error.field.unknown_role') });
  if (input.default_role === 'owner') errors.push({ field: 'default_role', code: 'invalid', message: msg('error.field.sso_no_owner') });
  if (errors.length) throw invalid(msg('error.check_the_provider'), errors);
}

export async function listProviders(ctx: Ctx) {
  return (await many(ctx, `SELECT * FROM sso_providers WHERE deleted_at IS NULL ORDER BY name`)).map(providerToApi);
}

export async function createProvider(ctx: Ctx, input: ProviderInput) {
  await check(ctx, input, false);
  const row = (
    await many(
      ctx,
      `INSERT INTO sso_providers (id, tenant_id, name, issuer, client_id, client_secret_encrypted, allowed_domains, default_role, enforce_sso, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        newId('sso'), ctx.tenantId, input.name!.trim(), input.issuer!.trim().replace(/\/$/, ''), input.client_id!.trim(), input.client_secret ? ctx.secrets.encrypt(input.client_secret) : null,
        [...new Set(input.allowed_domains!.map(cleanDomain).filter(Boolean))], input.default_role ?? 'read_only', input.enforce_sso ?? false, input.active ?? true,
      ],
    )
  )[0];
  await audit(ctx, { entity_type: 'sso_provider', entity_id: row.id, action: 'create', after: providerToApi(row) });
  return providerToApi(row);
}

export async function updateProvider(ctx: Ctx, id: string, input: ProviderInput) {
  const before = await must<any>(ctx, `SELECT * FROM sso_providers WHERE id = $1 AND deleted_at IS NULL`, [id], 'sso_provider', id);
  await check(ctx, input, true);
  const after = (
    await many(
      ctx,
      `UPDATE sso_providers SET name = coalesce($2, name), issuer = coalesce($3, issuer), client_id = coalesce($4, client_id),
              client_secret_encrypted = CASE WHEN $5 THEN $6 ELSE client_secret_encrypted END, allowed_domains = coalesce($7, allowed_domains),
              default_role = coalesce($8, default_role), enforce_sso = coalesce($9, enforce_sso), active = coalesce($10, active)
        WHERE id = $1 RETURNING *`,
      [
        id, input.name?.trim() ?? null, input.issuer?.trim().replace(/\/$/, '') ?? null, input.client_id?.trim() ?? null, input.client_secret !== undefined,
        input.client_secret ? ctx.secrets.encrypt(input.client_secret) : null, input.allowed_domains ? [...new Set(input.allowed_domains.map(cleanDomain).filter(Boolean))] : null,
        input.default_role ?? null, input.enforce_sso ?? null, input.active ?? null,
      ],
    )
  )[0];
  await audit(ctx, { entity_type: 'sso_provider', entity_id: id, action: 'update', before: providerToApi(before), after: providerToApi(after) });
  return providerToApi(after);
}

export async function deleteProvider(ctx: Ctx, id: string) {
  const before = await must<any>(ctx, `SELECT * FROM sso_providers WHERE id = $1 AND deleted_at IS NULL`, [id], 'sso_provider', id);
  await exec(ctx, `UPDATE sso_providers SET deleted_at = now(), active = false WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'sso_provider', entity_id: id, action: 'delete', before: providerToApi(before) });
}

// ---------------------------------------------------------------------------
// Signing in (system database access: no shop is known yet)
// ---------------------------------------------------------------------------

/**
 * Providers that vouch for this email's domain, for the sign-in page: only those of shops the person
 * belongs to. Any shop may name any domain, so on a multi-shop installation another shop's provider
 * must never be offered (or trusted) for someone else's staff. With one shop, a newcomer sees its
 * providers too; on a multi-shop installation newcomers use the shop's own sign-in link.
 */
export async function providersForEmail(db: Queryable, email: string) {
  const r = await db.query(
    `SELECT p.id, p.name, t.name AS tenant_name FROM sso_providers p JOIN tenants t ON t.id = p.tenant_id
      WHERE p.active AND p.deleted_at IS NULL AND $1 = ANY(p.allowed_domains)
        AND (EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = p.tenant_id AND lower(u.email) = $2)
             OR (NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = $2) AND (SELECT count(*) FROM tenants) = 1))
      ORDER BY t.name, p.name`,
    [domainOf(email), email.trim().toLowerCase()],
  );
  return r.rows as { id: string; name: string; tenant_name: string }[];
}

/** Refuses a password or emailed link for people whose domain must use single sign-on. */
export async function assertNoSsoRequired(db: Queryable, email: string) {
  // Only a shop the person belongs to may require single sign-on of them.
  const r = await db.query(
    `SELECT 1 FROM sso_providers p WHERE p.active AND p.enforce_sso AND p.deleted_at IS NULL AND $1 = ANY(p.allowed_domains)
        AND EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = p.tenant_id AND lower(u.email) = $2) LIMIT 1`,
    [domainOf(email), email.trim().toLowerCase()],
  );
  if (r.rows.length) throw new AppError('sso_required', 403, msg('error.sso_required'));
}

/** A provider with its client secret opened, for the protocol. */
export async function providerForLogin(db: Queryable, id: string, decrypt: (sealed: string) => string) {
  const p = (await db.query(`SELECT * FROM sso_providers WHERE id = $1 AND active AND deleted_at IS NULL`, [id])).rows[0];
  if (!p) throw new AppError('sso_unknown_provider', 404, msg('error.sso_unknown_provider'));
  return { id: p.id as string, tenantId: p.tenant_id as string, issuer: p.issuer as string, clientId: p.client_id as string, clientSecret: p.client_secret_encrypted ? decrypt(p.client_secret_encrypted) : null, allowedDomains: p.allowed_domains as string[], defaultRole: p.default_role as string };
}

/**
 * The provider said who this is: a verified email from an allowed domain signs in, joining the shop
 * with the default role the first time. A member whose access is turned off stays out.
 */
export async function completeSsoLogin(
  db: Queryable,
  p: { id: string; tenantId: string; allowedDomains: string[]; defaultRole: string },
  claims: { email?: unknown; email_verified?: unknown; name?: unknown },
  meta: { ip?: string; userAgent?: string },
) {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || claims.email_verified !== true) throw new AppError('sso_email_unverified', 403, msg('error.sso_email_unverified'));
  if (!p.allowedDomains.includes(domainOf(email))) throw new AppError('sso_domain_not_allowed', 403, msg('error.sso_domain_not_allowed', { domain: domainOf(email) }));
  let user = (await db.query(`SELECT * FROM users WHERE lower(email) = $1`, [email])).rows[0];
  if (user && user.status !== 'active') throw new AppError('sso_user_disabled', 403, msg('error.member_disabled'));
  // A shop's identity provider speaks only for that shop: someone who also belongs to another shop
  // signs in another way, or the provider could hand out a session for that other shop.
  if (user && (await db.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id <> $2 LIMIT 1`, [user.id, p.tenantId])).rows.length) {
    throw new AppError('sso_other_shop', 403, msg('error.sso_other_shop'));
  }
  if (!user) {
    user = (await db.query(`INSERT INTO users (id, email, name, status) VALUES ($1,$2,$3,'active') RETURNING *`, [newId('usr'), email, typeof claims.name === 'string' ? claims.name.slice(0, 200) : ''])).rows[0];
  }
  const m = (await db.query(`SELECT * FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [user.id, p.tenantId])).rows[0];
  if (m?.disabled_at) throw new AppError('sso_user_disabled', 403, msg('error.member_disabled'));
  let joined = false;
  if (!m) {
    const custom = !(SYSTEM_ROLES as readonly string[]).includes(p.defaultRole);
    const roleOk = custom ? (await db.query(`SELECT 1 FROM roles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [p.defaultRole, p.tenantId])).rows.length > 0 : true;
    const role: Role = custom ? (roleOk ? 'custom' : 'read_only') : (p.defaultRole as Role);
    await db.query(`INSERT INTO memberships (id, tenant_id, user_id, role, role_id) VALUES ($1,$2,$3,$4,$5)`, [newId('mem'), p.tenantId, user.id, role, role === 'custom' ? p.defaultRole : null]);
    joined = true;
  }
  const s = await createSession(db, user, meta, p.tenantId);
  return { ...s, userId: user.id as string, joined };
}
