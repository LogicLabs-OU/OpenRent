import type { Ctx } from '../context.ts';
import { AppError, notFound } from '../errors.ts';
import { audit } from '../events.ts';
import { t as msg } from '../i18n/index.ts';
import { newId } from '../ids.ts';
import { notifyStaff } from '../notifications/index.ts';
import { recordManualPayment } from '../payments/index.ts';
import { exec, json, many, one } from '../sql.ts';
import { localDate } from '../time.ts';
import { contextFor } from './index.ts';
import { accountingConnection } from './setup.ts';

/**
 * What reached the books (ADR 0009): every accounting entry with its sync status and the record it
 * became in the accounting system; sending again or marking as handled by hand; payments recorded in
 * the accounting system brought back; and a daily check that what was sent is still there unchanged.
 */
export type RecordStatus = 'not_connected' | 'before_sync' | 'paused' | 'waiting' | 'retrying' | 'sent' | 'skipped' | 'failed' | 'manual';

/** Which local record an entry's remote record hangs on: invoices and payments on their source. */
export function linkKeyFor(e: { id: string; source_type: string; source_id: string }) {
  return e.source_type === 'document' || e.source_type === 'payment' ? { localType: e.source_type, localId: e.source_id } : { localType: 'entry', localId: e.id };
}

export async function listRecords(ctx: Ctx, f: { kind?: string; status?: string; from?: string; to?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(Number(f.limit ?? 100), 1), 500);
  const entries = await many<any>(
    ctx,
    `SELECT * FROM accounting_entries WHERE ($1::text IS NULL OR kind = $1) AND ($2::date IS NULL OR entry_date >= $2) AND ($3::date IS NULL OR entry_date <= $3)
     ORDER BY number DESC LIMIT $4`,
    [f.kind ?? null, f.from ?? null, f.to ?? null, f.status ? 2000 : limit],
  );
  const live = await accountingConnection(ctx);
  const tz = (await one<{ timezone: string }>(ctx, `SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId]))?.timezone ?? 'UTC';
  const startDay = live?.c.sync_from ? localDate(new Date(live.c.sync_from), tz) : null;
  const tasks = new Map<string, any>();
  const links = new Map<string, any>();
  if (live && entries.length) {
    for (const t of await many<any>(
      ctx,
      `SELECT DISTINCT ON (object_id) object_id, status, message, attempts, finished_at FROM integration_tasks
        WHERE connection_id = $1 AND object_type = 'accounting_entry' AND object_id = ANY($2) ORDER BY object_id, created_at DESC`,
      [live.c.id, entries.map((e) => e.id)],
    ))
      tasks.set(t.object_id, t);
    const keys = entries.map(linkKeyFor);
    for (const l of await many<any>(
      ctx,
      `SELECT local_type, local_id, remote_id, extra FROM integration_links WHERE connection_id = $1 AND (local_type, local_id) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
      [live.c.id, keys.map((k) => k.localType), keys.map((k) => k.localId)],
    ))
      links.set(`${l.local_type}:${l.local_id}`, l);
  }
  const rows = entries.map((e) => {
    const key = linkKeyFor(e);
    const link = links.get(`${key.localType}:${key.localId}`);
    const task = tasks.get(e.id);
    let status: RecordStatus;
    if (!live) status = 'not_connected';
    else if (link?.extra?.manual) status = 'manual';
    else if (task?.status === 'failed') status = 'failed';
    else if (task?.status === 'pending' && task.attempts > 0) status = 'retrying';
    else if (link || task?.status === 'done') status = 'sent';
    else if (task?.status === 'skipped') status = 'skipped';
    else if (task) status = 'waiting';
    else if (startDay && String(e.entry_date).slice(0, 10) < startDay) status = 'before_sync';
    else if (live.c.settings?.sync_enabled !== true) status = 'paused';
    else status = 'waiting';
    const remoteId = link && !link.extra?.manual ? link.remote_id : null;
    return {
      object: 'accounting_record', entry_id: e.id, number: e.number, kind: e.kind, entry_date: String(e.entry_date).slice(0, 10),
      reference: e.reference, currency: String(e.currency).trim(), total: Number(e.total), source: { type: e.source_type, id: e.source_id }, order_id: e.order_id, reversal_of: e.reversal_of,
      status, message: status === 'manual' ? (link.extra.note ?? task?.message ?? null) : (task?.message ?? null),
      remote: remoteId
        ? {
            id: remoteId, number: link.extra?.remote_number ?? null, url: live?.p.remoteUrl?.(key.localType, remoteId, live.c.account ?? {}) ?? null,
            total: link.extra?.remote_total ?? null, status: link.extra?.remote_status ?? null, checked_at: link.extra?.checked_at ?? null, mismatch: link.extra?.mismatch === true,
          }
        : null,
    };
  });
  const filtered = f.status === 'mismatch' ? rows.filter((r) => r.remote?.mismatch) : f.status ? rows.filter((r) => r.status === f.status) : rows;
  return { object: 'list', data: filtered.slice(0, limit), connection: live ? { id: live.c.id, provider_id: live.p.id, provider_name: live.p.name } : null };
}

async function entryOrThrow(ctx: Ctx, id: string) {
  const e = await one<any>(ctx, `SELECT * FROM accounting_entries WHERE id = $1`, [id]);
  if (!e) throw notFound('accounting_entry', id);
  return e;
}

async function liveOrThrow(ctx: Ctx) {
  const live = await accountingConnection(ctx);
  if (!live || !['connected', 'error'].includes(live.c.status)) throw new AppError('accounting_not_connected', 409, msg('integrations.accounting_not_connected'));
  return live;
}

/** Sends an entry again now (e.g. after fixing the mapping). */
export async function resend(ctx: Ctx, entryId: string) {
  const e = await entryOrThrow(ctx, entryId);
  const { c } = await liveOrThrow(ctx);
  await exec(ctx, `UPDATE integration_tasks SET status = 'skipped', message = $3, finished_at = $4 WHERE connection_id = $1 AND object_id = $2 AND status = 'pending'`, [c.id, e.id, msg('integrations.replaced'), ctx.now]);
  await exec(
    ctx,
    `INSERT INTO integration_tasks (id, tenant_id, connection_id, source_key, event, object_type, object_id, next_attempt_at) VALUES ($1,$2,$3,$4,'accounting.entry_posted','accounting_entry',$5,$6)`,
    [newId('itk'), ctx.tenantId, c.id, `resend:${e.id}:${ctx.now.getTime()}`, e.id, ctx.now],
  );
  await audit(ctx, { entity_type: 'accounting_entry', entity_id: e.id, action: 'resend' });
  return { object: 'result', queued: 1 };
}

/** Records that staff put this entry in the books themselves; nothing more is sent for it. */
export async function markHandled(ctx: Ctx, entryId: string, note?: string) {
  const e = await entryOrThrow(ctx, entryId);
  const { c } = await liveOrThrow(ctx);
  const key = linkKeyFor(e);
  const existing = await one<any>(ctx, `SELECT remote_id FROM integration_links WHERE connection_id = $1 AND local_type = $2 AND local_id = $3`, [c.id, key.localType, key.localId]);
  if (existing) throw new AppError('already_sent', 409, msg('integrations.already_sent'));
  await exec(
    ctx,
    `INSERT INTO integration_links (tenant_id, connection_id, local_type, local_id, remote_id, extra) VALUES ($1,$2,$3,$4,'manual',$5)`,
    [ctx.tenantId, c.id, key.localType, key.localId, json({ manual: true, note: note?.slice(0, 500) ?? null, by: ctx.actor.id })],
  );
  await exec(ctx, `UPDATE integration_tasks SET status = 'skipped', message = $3, finished_at = $4 WHERE connection_id = $1 AND object_id = $2 AND status IN ('pending', 'failed')`, [c.id, e.id, msg('integrations.handled_manually'), ctx.now]);
  await audit(ctx, { entity_type: 'accounting_entry', entity_id: e.id, action: 'mark_handled', extra: { note: note ?? null } });
  return { object: 'result', handled: true };
}

/** The Accounting overview: connection, what is waiting or failed, and a month's totals by kind. */
export async function overview(ctx: Ctx, month?: string) {
  const live = await accountingConnection(ctx);
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const totals = await many<any>(
    ctx,
    `SELECT kind, currency, count(*)::int AS n, sum(total)::bigint AS total FROM accounting_entries WHERE to_char(entry_date, 'YYYY-MM') = $1 GROUP BY kind, currency ORDER BY kind`,
    [m],
  );
  const counts = live
    ? await one<any>(
        ctx,
        `SELECT count(*) FILTER (WHERE status = 'pending')::int AS waiting, count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'done')::int AS sent
           FROM integration_tasks WHERE connection_id = $1 AND object_type = 'accounting_entry'`,
        [live.c.id],
      )
    : null;
  const mismatches = live
    ? (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM integration_links WHERE connection_id = $1 AND (extra->>'mismatch')::boolean IS TRUE`, [live.c.id]))!.n
    : 0;
  const queued = (await one<{ n: number }>(ctx, `SELECT count(*)::int AS n FROM accounting_queue`))!.n;
  return {
    object: 'accounting_overview', month: m, unbooked: queued,
    connection: live ? { id: live.c.id, provider_id: live.p.id, provider_name: live.p.name, status: live.c.status, account_name: live.c.account_name, sync_enabled: live.c.settings?.sync_enabled === true, sync_from: live.c.sync_from, last_sync_at: live.c.last_sync_at, last_error: live.c.last_error } : null,
    counts: counts ? { ...counts, mismatches } : null,
    totals: totals.map((r) => ({ kind: r.kind, currency: String(r.currency).trim(), count: r.n, total: Number(r.total) })),
  };
}

/**
 * Brings back payments recorded in the accounting system against invoices OpenRent sent, as payments
 * on the order (when the shop turned it on). Each is linked to its remote record first, so it is never
 * sent back.
 */
export async function importRemotePayments(ctx: Ctx) {
  const live = await accountingConnection(ctx);
  if (!live || live.c.status !== 'connected' || !live.p.pullPayments || live.c.settings?.import_payments !== true || live.c.settings?.sync_enabled !== true) return 0;
  const { c, p } = live;
  const since = String(c.settings?.payments_cursor ?? new Date(c.sync_from ?? ctx.now).toISOString());
  const { ictx, saveTokens } = await contextFor(ctx, c, p);
  let list;
  try {
    list = await p.pullPayments!(ictx, since);
  } finally {
    await saveTokens();
  }
  let imported = 0;
  let cursor = since;
  for (const rp of list) {
    if (rp.date > cursor) cursor = rp.date;
    if (await one(ctx, `SELECT 1 FROM integration_links WHERE connection_id = $1 AND local_type = 'payment' AND remote_id = $2`, [c.id, rp.remoteId])) continue;
    const doc = await one<any>(
      ctx,
      `SELECT d.order_id, d.currency FROM integration_links l JOIN documents d ON d.id = l.local_id WHERE l.connection_id = $1 AND l.local_type = 'document' AND l.remote_id = $2`,
      [c.id, rp.invoiceRemoteId],
    );
    if (!doc?.order_id || String(doc.currency).trim() !== rp.currency || rp.amount <= 0) continue;
    const pay = await recordManualPayment(ctx, doc.order_id, { amount: rp.amount, method: 'bank_transfer', note: msg('integrations.recorded_in', { name: p.name, reference: rp.reference ?? rp.remoteId }) });
    await exec(
      ctx,
      `INSERT INTO integration_links (tenant_id, connection_id, local_type, local_id, remote_id, extra) VALUES ($1,$2,'payment',$3,$4,$5) ON CONFLICT DO NOTHING`,
      [ctx.tenantId, c.id, pay.id, rp.remoteId, json({ imported: true })],
    );
    imported++;
  }
  await exec(ctx, `UPDATE integration_connections SET settings = settings || jsonb_build_object('payments_cursor', $2::text) WHERE id = $1`, [c.id, cursor]);
  return imported;
}

/**
 * Daily: compares what the accounting system holds with what OpenRent sent in the last 90 days, and
 * tells staff about anything changed or removed there.
 */
export async function checkRemote(ctx: Ctx) {
  const live = await accountingConnection(ctx);
  if (!live || live.c.status !== 'connected' || !live.p.check) return 0;
  const { c, p } = live;
  const links = await many<any>(
    ctx,
    `SELECT l.local_type, l.local_id, l.remote_id, l.extra,
            CASE WHEN l.local_type = 'document' THEN (SELECT d.total FROM documents d WHERE d.id = l.local_id)
                 WHEN l.local_type = 'payment' THEN (SELECT abs(pm.amount) FROM payments pm WHERE pm.id = l.local_id) END AS local_total,
            CASE WHEN l.local_type = 'document' THEN (SELECT d.status FROM documents d WHERE d.id = l.local_id) END AS local_status
       FROM integration_links l
      WHERE l.connection_id = $1 AND l.local_type IN ('document', 'payment') AND l.remote_id <> 'manual' AND l.created_at > $2::timestamptz - interval '90 days'`,
    [c.id, ctx.now],
  );
  const { ictx, saveTokens } = await contextFor(ctx, c, p);
  let found = 0;
  try {
    for (let i = 0; i < links.length; i += 50) {
      const batch = links.slice(i, i + 50);
      const remote = new Map((await p.check!(ictx, batch.map((l) => ({ localType: l.local_type, remoteId: l.remote_id })))).map((r) => [r.remoteId, r]));
      for (const l of batch) {
        const r = remote.get(l.remote_id);
        if (!r) continue;
        const localVoided = l.local_status === 'voided';
        const mismatch = r.status === 'deleted' || (r.status === 'voided' && !localVoided) || (r.total !== null && Math.abs(Number(r.total)) !== Math.abs(Number(l.local_total ?? 0)));
        if (mismatch && !l.extra?.mismatch) found++;
        await exec(
          ctx,
          `UPDATE integration_links SET extra = extra || $4::jsonb, updated_at = now() WHERE connection_id = $1 AND local_type = $2 AND local_id = $3`,
          [c.id, l.local_type, l.local_id, json({ remote_total: r.total, remote_status: r.status, checked_at: ctx.now.toISOString(), mismatch })],
        );
      }
    }
  } finally {
    await saveTokens();
  }
  if (found) await notifyStaff(ctx, null, 'staff_accounting_issue', { count: found, name: p.name }, `accounting-check:${ctx.now.toISOString().slice(0, 10)}`);
  return found;
}

