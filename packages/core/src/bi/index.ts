import { randomBytes } from 'node:crypto';
import { t } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { conflict, invalid } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, many, must, one } from '../sql.ts';

/**
 * Data access for BI tools (FR-REP-5): database logins of the shop's own that read the views in schema
 * `bi` (orders, lines, payments, invoices, utilisation per day and the rest) and only this shop's rows.
 * The password is shown once, when a login is made or rotated.
 */
export interface BiRoles {
  /** Why logins cannot be made: `no_views` or `no_createrole`, or null when they can. */
  problem(): Promise<'no_views' | 'no_createrole' | null>;
  create(role: string, password: string): Promise<void>;
  setPassword(role: string, password: string): Promise<void>;
  drop(role: string): Promise<void>;
}

/** Where BI tools connect; what the operator set, else the database's own address. */
export interface BiConnection {
  host: string;
  port: number;
  database: string;
  sslmode: string;
}

export interface BiConfig {
  /** Off when the operator turned data access off (`OPENRENT_BI_ACCESS=off`); logins can still be revoked. */
  enabled: boolean;
  roles: BiRoles;
  connection: BiConnection;
}

/** The views a login reads, in the order the guide lists them. */
export const BI_VIEWS = ['shop', 'locations', 'products', 'variants', 'stock_items', 'customers', 'orders', 'order_lines', 'payments', 'invoices', 'utilisation_daily'] as const;

const MAX_LOGINS = 5;

export function biLoginToApi(r: any) {
  return { id: r.id, object: 'bi_login', name: r.name, username: r.role_name, created_by: r.created_by, rotated_at: r.rotated_at, created_at: r.created_at };
}

/**
 * Runs `fn` in a transaction of the shop. Roles are made and dropped on a connection of their own, between
 * such transactions and never inside one: a database login is not part of the shop's data, and an open
 * transaction must not wait on another connection.
 */
export type InShop = <T>(fn: (ctx: Ctx) => Promise<T>) => Promise<T>;

type Problem = 'off' | 'no_views' | 'no_createrole' | 'unreachable';

async function problem(bi: BiConfig | null | undefined, logger: Ctx['logger']): Promise<Problem | null> {
  if (!bi?.enabled) return 'off';
  try {
    return await bi.roles.problem();
  } catch (err) {
    logger.warn({ err }, 'BI roles could not be checked');
    return 'unreachable';
  }
}

const refuse = (p: Problem) => conflict(`bi_${p}`, t(`bi.${p}`));
const password = () => randomBytes(24).toString('base64url');

/** The shop's logins, where tools connect, and whether logins can be made on this installation. */
export async function biAccess(inShop: InShop, bi: BiConfig | null | undefined, logger: Ctx['logger']) {
  const p = await problem(bi, logger);
  const rows = await inShop((ctx) => many(ctx, `SELECT * FROM bi_access ORDER BY created_at, id`));
  return {
    object: 'bi_access',
    available: !p,
    problem: p ? { code: `bi_${p}`, message: t(`bi.${p}`) } : null,
    connection: bi?.enabled ? bi.connection : null,
    views: BI_VIEWS.map((v) => `bi.${v}`),
    data: rows.map(biLoginToApi),
    max_logins: MAX_LOGINS,
  };
}

export async function createBiLogin(inShop: InShop, bi: BiConfig | null | undefined, logger: Ctx['logger'], input: { name: string }) {
  const name = String(input.name ?? '').trim().slice(0, 100);
  if (!name) throw invalid(t('bi.name_required'), [{ field: 'name', code: 'required', message: t('bi.name_required') }]);
  const p = await problem(bi, logger);
  if (p) throw refuse(p);
  const count = await inShop(async (ctx) => (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM bi_access`))!.n);
  if (count >= MAX_LOGINS) throw conflict('bi_login_limit', t('bi.login_limit', { max: MAX_LOGINS }));
  const role = `openrent_bi_${randomBytes(6).toString('hex')}`;
  const secret = password();
  await bi!.roles.create(role, secret);
  try {
    const row = await inShop(async (ctx) => {
      const r = await one(ctx, `INSERT INTO bi_access (id, tenant_id, name, role_name, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [newId('bia'), ctx.tenantId, name, role, ctx.actor.id]);
      await audit(ctx, { entity_type: 'bi_login', entity_id: r.id, action: 'create', extra: { name, username: role } });
      return r;
    });
    return { ...biLoginToApi(row), password: secret, connection: bi!.connection };
  } catch (err) {
    await bi!.roles.drop(role).catch(() => undefined);
    throw err;
  }
}

/** A new password; the old one stops working at once. */
export async function rotateBiLogin(inShop: InShop, bi: BiConfig | null | undefined, logger: Ctx['logger'], id: string) {
  const row = await inShop((ctx) => must<any>(ctx, `SELECT * FROM bi_access WHERE id = $1`, [id], 'bi_login', id));
  const p = await problem(bi, logger);
  if (p) throw refuse(p);
  const secret = password();
  await bi!.roles.setPassword(row.role_name, secret);
  const next = await inShop(async (ctx) => {
    const r = await one(ctx, `UPDATE bi_access SET rotated_at = $2 WHERE id = $1 RETURNING *`, [id, ctx.now]);
    await audit(ctx, { entity_type: 'bi_login', entity_id: id, action: 'rotate', extra: { name: row.name, username: row.role_name } });
    return r;
  });
  return { ...biLoginToApi(next ?? row), password: secret, connection: bi!.connection };
}

/** The login goes, and its open sessions end. With data access turned off, logins can still be revoked. */
export async function revokeBiLogin(inShop: InShop, bi: BiConfig | null | undefined, id: string) {
  const row = await inShop((ctx) => must<any>(ctx, `SELECT * FROM bi_access WHERE id = $1`, [id], 'bi_login', id));
  if (!bi) throw refuse('off');
  await bi.roles.drop(row.role_name);
  await inShop(async (ctx) => {
    await exec(ctx, `DELETE FROM bi_access WHERE id = $1`, [id]);
    await audit(ctx, { entity_type: 'bi_login', entity_id: id, action: 'revoke', extra: { name: row.name, username: row.role_name } });
  });
  return { ...biLoginToApi(row), deleted: true };
}
