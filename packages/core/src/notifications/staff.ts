import type { Ctx } from '../context.ts';
import { AppError, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, json, many, one } from '../sql.ts';

/**
 * In-app notices for staff (FR-NOT-3). Each kind matches a staff email template; members choose per kind
 * whether they want the notice in the admin, by email, or both. Rows hold the kind and parameters only.
 */
export const STAFF_KINDS = [
  'staff_new_order', 'staff_payment_failed', 'staff_overdue', 'deposit_expiring', 'staff_cancellation_requested',
  'staff_low_availability', 'staff_webhook_disabled', 'staff_export_ready', 'staff_extension_requested', 'staff_delivery_failed',
  'staff_ticket_assigned', 'staff_service_due', 'staff_accounting_issue',
] as const;
export type StaffKind = (typeof STAFF_KINDS)[number];

/** Members who see order work: owners, admins and staff. */
const ROLES = ['owner', 'admin', 'staff'];

export interface Prefs {
  [kind: string]: { in_app?: boolean; email?: boolean };
}

export async function staffMembers(ctx: Ctx) {
  return many<{ user_id: string; email: string; prefs: Prefs }>(
    ctx,
    `SELECT u.id AS user_id, u.email, m.notification_prefs AS prefs FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = ANY($1) AND u.status = 'active'`,
    [ROLES],
  );
}

/** Simple values only, so the admin can write the text in each reader's language. */
function flatParams(extra: Record<string, unknown>, data: Record<string, any>) {
  const out: Record<string, string | number> = {};
  if (data.order?.number) out.number = data.order.number;
  if (data.customer?.name) out.customer = data.customer.name;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    else if (v && typeof v === 'object')
      for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'string' || typeof v2 === 'number') out[`${k}_${k2}`] = v2;
  }
  return out;
}

export async function addStaffNotices(ctx: Ctx, kind: string, extra: Record<string, unknown>, data: Record<string, any>, entity: { type: string; id: string } | null, dedupeKey?: string) {
  const params = flatParams(extra, data);
  for (const m of await staffMembers(ctx)) {
    if (m.prefs?.[kind]?.in_app === false) continue;
    await exec(
      ctx,
      `INSERT INTO staff_notifications (id, tenant_id, user_id, kind, params, entity_type, entity_id, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [newId('stn'), ctx.tenantId, m.user_id, kind, json(params), entity?.type ?? null, entity?.id ?? null, dedupeKey ?? null],
    );
  }
}

/** Emails of members who still want this kind by email. */
export async function emailRecipients(ctx: Ctx, kind: string) {
  return (await staffMembers(ctx)).filter((m) => m.prefs?.[kind]?.email !== false).map((m) => m.email);
}

function me(ctx: Ctx) {
  if (ctx.actor.type !== 'user' || !ctx.actor.id) throw new AppError('forbidden', 403, msg('error.forbidden'));
  return ctx.actor.id;
}

export function noticeToApi(r: any) {
  return { id: r.id, object: 'staff_notification', kind: r.kind, params: r.params, entity_type: r.entity_type, entity_id: r.entity_id, read_at: r.read_at, created_at: r.created_at };
}

export async function myNotices(ctx: Ctx, opts: { unread?: boolean; limit?: number } = {}) {
  const user = me(ctx);
  const rows = await many(ctx, `SELECT * FROM staff_notifications WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) ORDER BY created_at DESC LIMIT $3`, [
    user, opts.unread ?? null, Math.min(opts.limit ?? 30, 100),
  ]);
  const unread = (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM staff_notifications WHERE user_id = $1 AND read_at IS NULL`, [user]))!.n;
  return { object: 'list', data: rows.map(noticeToApi), unread_count: unread };
}

export async function markNoticeRead(ctx: Ctx, id: string) {
  const row = (await many(ctx, `UPDATE staff_notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *`, [id, me(ctx)]))[0];
  if (!row) throw notFound('staff_notification', id);
  return noticeToApi(row);
}

export async function markAllNoticesRead(ctx: Ctx) {
  const n = (await many(ctx, `UPDATE staff_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id`, [me(ctx)])).length;
  return { object: 'result', marked: n };
}

export async function myPreferences(ctx: Ctx) {
  const row = await one<{ prefs: Prefs }>(ctx, `SELECT notification_prefs AS prefs FROM memberships WHERE user_id = $1`, [me(ctx)]);
  const prefs = row?.prefs ?? {};
  return { object: 'notification_preferences', kinds: STAFF_KINDS.map((k) => ({ kind: k, in_app: prefs[k]?.in_app !== false, email: prefs[k]?.email !== false })) };
}

export async function setMyPreferences(ctx: Ctx, input: { kinds: { kind: string; in_app?: boolean; email?: boolean }[] }) {
  const user = me(ctx);
  const row = await one<{ prefs: Prefs }>(ctx, `SELECT notification_prefs AS prefs FROM memberships WHERE user_id = $1`, [user]);
  const prefs: Prefs = { ...(row?.prefs ?? {}) };
  for (const k of input.kinds) {
    if (!(STAFF_KINDS as readonly string[]).includes(k.kind)) continue;
    prefs[k.kind] = { ...(prefs[k.kind] ?? {}), ...(k.in_app !== undefined ? { in_app: k.in_app } : {}), ...(k.email !== undefined ? { email: k.email } : {}) };
  }
  await exec(ctx, `UPDATE memberships SET notification_prefs = $2 WHERE user_id = $1`, [user, json(prefs)]);
  return myPreferences(ctx);
}
