import type { Queryable } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { t as msg } from '../i18n/index.ts';
import { newId } from '../ids.ts';

/**
 * Running many shops on one installation (managed cloud, PRD §10.1): limits per shop, suspending and
 * resuming a shop, and erasing one for good. These run for the installation's operator, outside any
 * shop (the system database context), never for shop staff.
 */
export interface ShopLimits {
  /** Orders created in a calendar month (shop time). */
  orders_per_month?: number | null;
  /** Files stored, in megabytes. */
  storage_mb?: number | null;
  /** Plugins the shop has turned on itself. */
  plugins?: number | null;
}
const LIMIT_KEYS = ['orders_per_month', 'storage_mb', 'plugins'] as const;

export function checkLimits(input: unknown): ShopLimits {
  const errors: FieldError[] = [];
  const out: ShopLimits = {};
  if (!input || typeof input !== 'object') throw invalid(msg('error.limits_invalid'), [{ field: 'limits', code: 'invalid', message: msg('error.limits_invalid') }]);
  for (const [k, v] of Object.entries(input)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(k)) errors.push({ field: `limits.${k}`, code: 'unknown', message: msg('error.limits_invalid') });
    else if (v !== null && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10_000_000)) errors.push({ field: `limits.${k}`, code: 'invalid', message: msg('error.limits_invalid') });
    else out[k as keyof ShopLimits] = v as number | null;
  }
  if (errors.length) throw invalid(msg('error.limits_invalid'), errors);
  return out;
}

/** Installation defaults for new shops (`OPENRENT_DEFAULT_LIMITS`, JSON); an invalid value is ignored. */
export function defaultLimits(raw: string | undefined | null): ShopLimits {
  if (!raw) return {};
  try {
    return checkLimits(JSON.parse(raw));
  } catch {
    return {};
  }
}

const LIMIT_OF = { orders: 'orders_per_month', storage: 'storage_mb', plugins: 'plugins' } as const;

/**
 * Refuses what would take the shop over one of its limits (402, as a plan limit is): one more order,
 * `bytes` more storage, one more plugin turned on. No limit set means none.
 */
export async function assertWithinLimit(ctx: { db: Queryable; tenantId: string }, kind: keyof typeof LIMIT_OF, bytes = 0) {
  const t = (await ctx.db.query(`SELECT limits FROM tenants WHERE id = $1`, [ctx.tenantId])).rows[0];
  const limit = t?.limits?.[LIMIT_OF[kind]];
  if (limit === undefined || limit === null) return;
  const u = await usageOf(ctx.db, ctx.tenantId);
  const over = kind === 'orders' ? u.orders_this_month + 1 > limit : kind === 'plugins' ? u.plugins_enabled + 1 > limit : u.storage_bytes + bytes > limit * 1024 * 1024;
  if (over) throw new AppError('plan_limit', 402, msg(`error.limit_${kind}`, { limit }));
}

export function shopToOperator(r: any) {
  return {
    id: r.id, object: 'operator_shop', slug: r.slug, name: r.name, status: r.status, suspended_reason: r.suspended_reason ?? null, suspended_at: r.suspended_at ?? null,
    limits: r.limits ?? {}, created_at: r.created_at,
    usage: r.usage ?? undefined,
  };
}

/** What a shop uses now, against its limits. */
export async function usageOf(db: Queryable, tenantId: string) {
  const r = (
    await db.query(
      `SELECT
         (SELECT count(*)::int FROM orders o, tenants t WHERE o.tenant_id = $1 AND t.id = $1
            AND o.created_at >= (date_trunc('month', now() AT TIME ZONE t.timezone) AT TIME ZONE t.timezone)) AS orders_this_month,
         (SELECT coalesce(sum(size), 0)::bigint FROM files WHERE tenant_id = $1) AS storage_bytes,
         (SELECT count(*)::int FROM plugins WHERE tenant_id = $1 AND enabled) AS plugins_enabled`,
      [tenantId],
    )
  ).rows[0];
  return { orders_this_month: r.orders_this_month, storage_bytes: Number(r.storage_bytes), plugins_enabled: r.plugins_enabled };
}

export async function listShops(db: Queryable) {
  const rows = (await db.query(`SELECT id, slug, name, status, suspended_reason, suspended_at, limits, created_at FROM tenants ORDER BY created_at`)).rows;
  return Promise.all(rows.map(async (r: any) => shopToOperator({ ...r, usage: await usageOf(db, r.id) })));
}

async function shop(db: Queryable, id: string) {
  const r = (await db.query(`SELECT * FROM tenants WHERE id = $1`, [id])).rows[0];
  if (!r) throw new AppError('not_found', 404, msg('error.shop_not_found'));
  return r;
}

async function record(db: Queryable, tenantId: string, action: string, extra: Record<string, unknown>) {
  await db.query(
    `INSERT INTO audit_log (id, tenant_id, actor_type, actor_id, entity_type, entity_id, action, diff) VALUES ($1,$2,'operator',NULL,'tenant',$2,$3,$4)`,
    [newId('aud'), tenantId, action, JSON.stringify(extra)],
  );
}

export async function setLimits(db: Queryable, id: string, limits: unknown) {
  const before = await shop(db, id);
  const next = { ...(before.limits ?? {}), ...checkLimits(limits) };
  await db.query(`UPDATE tenants SET limits = $2 WHERE id = $1`, [id, JSON.stringify(next)]);
  await record(db, id, 'limits', { before: before.limits ?? {}, after: next });
  return shopToOperator({ ...(await shop(db, id)), usage: await usageOf(db, id) });
}

/** A suspended shop's admin and storefront answer "suspended"; its data stays. */
export async function suspendShop(db: Queryable, id: string, reason: string | null) {
  await shop(db, id);
  await db.query(`UPDATE tenants SET status = 'suspended', suspended_reason = $2, suspended_at = now() WHERE id = $1`, [id, reason?.trim().slice(0, 500) || null]);
  await record(db, id, 'suspend', { reason });
  return shopToOperator(await shop(db, id));
}

export async function resumeShop(db: Queryable, id: string) {
  await shop(db, id);
  await db.query(`UPDATE tenants SET status = 'active', suspended_reason = NULL, suspended_at = NULL WHERE id = $1`, [id]);
  await record(db, id, 'resume', {});
  return shopToOperator(await shop(db, id));
}
