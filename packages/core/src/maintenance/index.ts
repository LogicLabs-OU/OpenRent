import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { t } from '../i18n/index.ts';
import { newId } from '../ids.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { money } from '../crud.ts';
import { getFile, setOwner } from '../files/index.ts';
import { setStockItemStatus } from '../inventory/index.ts';
import { openTicketOf } from './tickets.ts';
import { recordServiceEvent } from '../servicing/events.ts';

export { ensureTicket, releaseUnit, openTicketOf } from './tickets.ts';

/** Staff-only photo URLs (inspection, damage, maintenance); served behind the session. */
export const photoUrls = (fileId: string) => ({ file_id: fileId, url: `/api/v1/files/${fileId}/content?variant=lg`, url_sm: `/api/v1/files/${fileId}/content?variant=sm` });

export async function photosOf(ctx: Ctx, ownerType: string, ownerIds: string[]): Promise<Map<string, ReturnType<typeof photoUrls>[]>> {
  const out = new Map<string, ReturnType<typeof photoUrls>[]>();
  if (!ownerIds.length) return out;
  for (const f of await many<{ id: string; owner_id: string }>(ctx, `SELECT id, owner_id FROM files WHERE owner_type = $1 AND owner_id = ANY($2) AND kind = 'photo' ORDER BY created_at`, [ownerType, ownerIds])) {
    out.set(f.owner_id, [...(out.get(f.owner_id) ?? []), photoUrls(f.id)]);
  }
  return out;
}

/** Attaches an uploaded photo (POST /files?purpose=photo) to a ticket, damage charge or unit. */
export async function attachPhoto(ctx: Ctx, ownerType: 'maintenance_ticket' | 'damage_charge' | 'stock_item' | 'delivery', ownerId: string, fileId: string) {
  const f = await getFile(ctx, fileId);
  if (f.kind !== 'photo') throw invalid(t('images.not_an_image'), [{ field: 'file_id', code: 'not_photo', message: t('images.not_an_image') }]);
  if (f.owner_type && !(f.owner_type === ownerType && f.owner_id === ownerId)) throw new AppError('file_in_use', 409, t('images.in_use'));
  await setOwner(ctx, fileId, ownerType, ownerId);
  await audit(ctx, { entity_type: ownerType, entity_id: ownerId, action: 'add_photo', extra: { file_id: fileId } });
  return photoUrls(fileId);
}

export type TicketStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];
const CLOSED = ['done', 'cancelled'];
const DOWN = ['needs_inspection', 'soft_down', 'hard_down'];

export interface Part {
  name: string;
  quantity: number;
  unit_cost: number;
}

const SELECT = `SELECT m.*, s.barcode, s.status AS unit_status, s.location_id, p.name AS product_name, v.name AS variant_name, o.number AS order_number,
    u.name AS assignee_name, u.email AS assignee_email, t.currency
  FROM maintenance_tickets m JOIN stock_items s ON s.id = m.stock_item_id JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
  JOIN tenants t ON t.id = m.tenant_id LEFT JOIN orders o ON o.id = m.created_from_order_id LEFT JOIN users u ON u.id = m.assignee_id`;

/** The ticket's other units, with their state. */
async function extraUnits(ctx: Ctx, ids: string[]) {
  const out = new Map<string, any[]>();
  if (!ids.length) return out;
  const rows = await many<any>(
    ctx,
    `SELECT mu.ticket_id, mu.released_at, s.id, s.barcode, s.status, s.location_id, p.name AS product_name, v.name AS variant_name FROM maintenance_ticket_units mu
       JOIN stock_items s ON s.id = mu.stock_item_id JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
      WHERE mu.ticket_id = ANY($1) ORDER BY mu.created_at`,
    [ids],
  );
  for (const r of rows) out.set(r.ticket_id, [...(out.get(r.ticket_id) ?? []), r]);
  return out;
}

const partsCost = (parts: Part[]) => (parts ?? []).reduce((a, x) => a + Math.round(Number(x.quantity) * Number(x.unit_cost)), 0);

function ticketToApi(r: any, photos: ReturnType<typeof photoUrls>[] = [], extras: any[] = [], now = new Date()) {
  const unit = (x: any) => ({ id: x.id, barcode: x.barcode, status: x.status, location_id: x.location_id, product_name: x.product_name, variant_name: x.variant_name });
  const currency = String(r.currency ?? 'EUR');
  const parts: Part[] = r.parts ?? [];
  const open = !CLOSED.includes(r.status);
  return {
    id: r.id, object: 'maintenance_ticket', status: r.status as TicketStatus, priority: r.priority as TicketPriority, severity: r.severity, title: r.title, notes: r.notes,
    stock_item: { id: r.stock_item_id, barcode: r.barcode, status: r.unit_status, location_id: r.location_id, product_name: r.product_name, variant_name: r.variant_name },
    units: [{ id: r.stock_item_id, barcode: r.barcode, status: r.unit_status, location_id: r.location_id, product_name: r.product_name, variant_name: r.variant_name }, ...extras.map(unit)],
    assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name || r.assignee_email } : null,
    due_at: r.due_at, overdue: open && !!r.due_at && new Date(r.due_at) < now,
    cost: money(r.cost, currency), parts, parts_cost: money(partsCost(parts), currency), total_cost: money(Number(r.cost) + partsCost(parts), currency),
    resolution: r.resolution, service_interval_id: r.service_interval_id ?? null,
    order: r.created_from_order_id ? { id: r.created_from_order_id, number: r.order_number } : null,
    photos, started_at: r.started_at, closed_at: r.closed_at, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export interface TicketFilter {
  /** `active` (default): open and in progress. */
  status?: 'active' | TicketStatus;
  location_id?: string;
  assignee_id?: string;
  priority?: TicketPriority;
  overdue?: boolean;
}

/** Tickets, most urgent first: priority, then overdue, then due date. */
export async function listTickets(ctx: Ctx, f: TicketFilter = {}) {
  const status = f.status && f.status !== 'active' ? f.status : null;
  const rows = await many(
    ctx,
    `${SELECT} WHERE ($1::text IS NULL AND m.status NOT IN ('done','cancelled') OR m.status = $1) AND ($2::text IS NULL OR s.location_id = $2)
       AND ($3::text IS NULL OR m.assignee_id = $3) AND ($4::text IS NULL OR m.priority = $4)
       AND (NOT $5 OR (m.due_at < $6 AND m.status NOT IN ('done','cancelled')))
     ORDER BY array_position(ARRAY['urgent','high','normal','low'], m.priority), m.due_at NULLS LAST, m.severity DESC, m.created_at LIMIT 200`,
    [status, f.location_id ?? null, f.assignee_id ?? null, f.priority ?? null, !!f.overdue, ctx.now],
  );
  const ids = rows.map((r) => r.id);
  const photos = await photosOf(ctx, 'maintenance_ticket', ids);
  const extras = await extraUnits(ctx, ids);
  return rows.map((r) => ticketToApi(r, photos.get(r.id), extras.get(r.id), ctx.now));
}

export async function getTicket(ctx: Ctx, id: string) {
  const r = await must(ctx, `${SELECT} WHERE m.id = $1`, [id], 'maintenance_ticket', id);
  return ticketToApi(r, (await photosOf(ctx, 'maintenance_ticket', [id])).get(id), (await extraUnits(ctx, [id])).get(id), ctx.now);
}

export interface TicketInput {
  title?: string;
  notes?: string;
  priority?: TicketPriority;
  assignee_id?: string | null;
  due_at?: string | null;
  cost?: number;
  parts?: Part[];
}

/** Checks the editable fields; every problem is reported against its field. */
async function checkFields(ctx: Ctx, input: TicketInput, errors: FieldError[]) {
  if (input.title !== undefined && !input.title.trim()) errors.push({ field: 'title', code: 'required', message: t('error.field.enter_a_title') });
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) errors.push({ field: 'priority', code: 'invalid', message: t('error.field.ticket_priority') });
  if (input.assignee_id) {
    const member = await one(ctx, `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1 AND u.status = 'active'`, [input.assignee_id]);
    if (!member) errors.push({ field: 'assignee_id', code: 'not_found', message: t('error.field.ticket_assignee') });
  }
  if (input.due_at && Number.isNaN(new Date(input.due_at).getTime())) errors.push({ field: 'due_at', code: 'invalid', message: t('error.field.invalid_date_time') });
  if (input.cost !== undefined && (!Number.isInteger(input.cost) || input.cost < 0)) errors.push({ field: 'cost', code: 'invalid', message: t('error.field.ticket_cost') });
  for (const [i, x] of (input.parts ?? []).entries()) {
    if (!x.name?.trim()) errors.push({ field: `parts[${i}].name`, code: 'required', message: t('error.field.enter_a_name') });
    if (!(Number(x.quantity) > 0)) errors.push({ field: `parts[${i}].quantity`, code: 'invalid', message: t('error.field.enter_a_quantity') });
    if (!Number.isInteger(x.unit_cost) || x.unit_cost < 0) errors.push({ field: `parts[${i}].unit_cost`, code: 'invalid', message: t('error.field.ticket_cost') });
  }
}

const cleanParts = (parts: Part[]) => parts.map((x) => ({ name: x.name.trim(), quantity: Number(x.quantity), unit_cost: x.unit_cost }));

/** Tells the assignee (in the admin) that a ticket is theirs, unless they assigned it to themselves. */
async function tellAssignee(ctx: Ctx, ticketId: string, assigneeId: string | null | undefined, title: string) {
  if (!assigneeId || (ctx.actor.type === 'user' && ctx.actor.id === assigneeId)) return;
  const m = await one<{ prefs: any }>(ctx, `SELECT notification_prefs AS prefs FROM memberships WHERE user_id = $1`, [assigneeId]);
  if (m?.prefs?.staff_ticket_assigned?.in_app === false) return;
  await exec(ctx, `INSERT INTO staff_notifications (id, tenant_id, user_id, kind, params, entity_type, entity_id) VALUES ($1,$2,$3,'staff_ticket_assigned',$4,'maintenance_ticket',$5)`, [
    newId('stn'), ctx.tenantId, assigneeId, json({ title }), ticketId,
  ]);
}

/**
 * A ticket for one or more units (FR-MNT-2). The units go out of service with the ticket's severity
 * (their downtime starts now); a unit that is out on rental or already on an open ticket is refused.
 */
export async function createTicket(
  ctx: Ctx,
  input: TicketInput & { stock_item_ids: string[]; severity?: 'soft_down' | 'hard_down'; keep_in_service?: boolean; service_interval_id?: string | null },
) {
  const errors: FieldError[] = [];
  await checkFields(ctx, input, errors);
  const ids = [...new Set(input.stock_item_ids ?? [])];
  if (!ids.length) errors.push({ field: 'stock_item_ids', code: 'required', message: t('error.field.ticket_units') });
  const units: any[] = [];
  for (const [i, id] of ids.entries()) {
    const u = await one<any>(ctx, `SELECT s.id, s.barcode, s.status, p.name AS product FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.id = $1`, [id]);
    const field = `stock_item_ids[${i}]`;
    if (!u) errors.push({ field, code: 'not_found', message: t('error.field.ticket_units') });
    else if (['out', 'in_transit', 'retired', 'lost'].includes(u.status)) errors.push({ field, code: 'unit_unavailable', message: t('error.field.ticket_unit_status', { barcode: u.barcode, status: t(`stock.status.${u.status as 'out'}`) }) });
    else if (await openTicketOf(ctx, u.id)) errors.push({ field, code: 'already_open', message: t('error.field.ticket_unit_open', { barcode: u.barcode }) });
    else units.push(u);
  }
  if (errors.length) throw invalid(t('error.check_the_ticket'), errors);
  const severity = input.severity ?? 'soft_down';
  const title = input.title?.trim() || `${units[0].product} ${units[0].barcode}`;
  const id = newId('mtk');
  await exec(
    ctx,
    `INSERT INTO maintenance_tickets (id, tenant_id, stock_item_id, severity, title, notes, priority, assignee_id, due_at, cost, parts, created_by, service_interval_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id, ctx.tenantId, units[0].id, severity, title, input.notes?.trim() ?? '', input.priority ?? 'normal', input.assignee_id || null, input.due_at || null, input.cost ?? 0,
      json(cleanParts(input.parts ?? [])), ctx.actor.id, input.service_interval_id ?? null,
    ],
  );
  for (const u of units.slice(1)) await exec(ctx, `INSERT INTO maintenance_ticket_units (id, tenant_id, ticket_id, stock_item_id) VALUES ($1,$2,$3,$4)`, [newId('mtu'), ctx.tenantId, id, u.id]);
  // Out of service with the ticket (the status change finds this ticket and keeps it), unless it is a
  // service the unit can wait for.
  if (!input.keep_in_service)
    for (const u of units) if (!DOWN.includes(u.status) || (severity === 'hard_down' && u.status !== 'hard_down')) await setStockItemStatus(ctx, u.id, severity, '', { system: true });
  const api = await getTicket(ctx, id);
  await audit(ctx, { entity_type: 'maintenance_ticket', entity_id: id, action: 'create', after: api });
  await emit(ctx, 'maintenance_ticket.created', { type: 'maintenance_ticket', id }, api);
  await tellAssignee(ctx, id, input.assignee_id, title);
  return api;
}

async function openRow(ctx: Ctx, id: string) {
  const tk = await must<any>(ctx, `SELECT * FROM maintenance_tickets WHERE id = $1 FOR UPDATE`, [id], 'maintenance_ticket', id);
  if (CLOSED.includes(tk.status)) throw new AppError('ticket_closed', 409, t('maintenance.closed'));
  return tk;
}

export async function updateTicket(ctx: Ctx, id: string, patch: TicketInput & { status?: 'open' | 'in_progress' }) {
  const before = await openRow(ctx, id);
  const errors: FieldError[] = [];
  await checkFields(ctx, patch, errors);
  if (errors.length) throw invalid(t('error.check_the_ticket'), errors);
  const sets: string[] = [];
  const vals: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (patch.status) set('status', patch.status);
  if (patch.status === 'in_progress' && !before.started_at) set('started_at', ctx.now);
  if (patch.title !== undefined) set('title', patch.title.trim());
  if (patch.notes !== undefined) set('notes', patch.notes);
  if (patch.priority !== undefined) set('priority', patch.priority);
  if (patch.assignee_id !== undefined) set('assignee_id', patch.assignee_id || null);
  if (patch.due_at !== undefined) set('due_at', patch.due_at || null);
  if (patch.cost !== undefined) set('cost', patch.cost);
  if (patch.parts !== undefined) set('parts', json(cleanParts(patch.parts)));
  if (!sets.length) return getTicket(ctx, id);
  const after = (await many(ctx, `UPDATE maintenance_tickets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals))[0];
  await audit(ctx, { entity_type: 'maintenance_ticket', entity_id: id, action: 'update', before, after });
  if (patch.assignee_id && patch.assignee_id !== before.assignee_id) await tellAssignee(ctx, id, patch.assignee_id, after.title);
  return getTicket(ctx, id);
}

/** Work on the repair has begun. */
export async function startTicket(ctx: Ctx, id: string) {
  const tk = await openRow(ctx, id);
  if (tk.status === 'in_progress') return getTicket(ctx, id);
  await exec(ctx, `UPDATE maintenance_tickets SET status = 'in_progress', started_at = coalesce(started_at, $2) WHERE id = $1`, [id, ctx.now]);
  await audit(ctx, { entity_type: 'maintenance_ticket', entity_id: id, action: 'start' });
  const api = await getTicket(ctx, id);
  await emit(ctx, 'maintenance_ticket.started', { type: 'maintenance_ticket', id }, api);
  return api;
}

/** Every unit on the ticket that has not left it yet. */
async function ticketUnits(ctx: Ctx, tk: any) {
  const extras = await many<{ stock_item_id: string }>(ctx, `SELECT stock_item_id FROM maintenance_ticket_units WHERE ticket_id = $1 AND released_at IS NULL`, [tk.id]);
  return [tk.stock_item_id, ...extras.map((x) => x.stock_item_id)];
}

/** Puts the units back into service (or retires them) and closes the ticket as done or cancelled. */
async function finish(ctx: Ctx, tk: any, status: 'done' | 'cancelled', outcome: 'available' | 'retired', note: string) {
  const units = await ticketUnits(ctx, tk);
  for (const u of units) {
    const s = await one<{ status: string }>(ctx, `SELECT status FROM stock_items WHERE id = $1`, [u]);
    if (s?.status === 'out') throw new AppError('unit_is_out', 409, t('maintenance.unit_out'));
  }
  // Mark the ticket first, so the status changes below do not close it a second time.
  await exec(ctx, `UPDATE maintenance_tickets SET status = $2, closed_at = $3 WHERE id = $1`, [tk.id, status, ctx.now]);
  await exec(ctx, `UPDATE maintenance_ticket_units SET released_at = $2 WHERE ticket_id = $1 AND released_at IS NULL`, [tk.id, ctx.now]);
  for (const u of units) {
    const s = await one<{ status: string }>(ctx, `SELECT status FROM stock_items WHERE id = $1`, [u]);
    if (s && (DOWN.includes(s.status) || outcome === 'retired')) await setStockItemStatus(ctx, u, outcome, note, { system: true });
  }
}

/** The repair is finished (FR-MNT-2): units back into service or retired, with what was done. */
export async function resolveTicket(ctx: Ctx, id: string, input: { outcome?: 'available' | 'retired'; resolution?: string; notes?: string; cost?: number; parts?: Part[] }) {
  const tk = await openRow(ctx, id);
  const errors: FieldError[] = [];
  await checkFields(ctx, { cost: input.cost, parts: input.parts }, errors);
  if (errors.length) throw invalid(t('error.check_the_ticket'), errors);
  const outcome = input.outcome ?? 'available';
  if (input.notes) await exec(ctx, `UPDATE maintenance_tickets SET notes = trim(notes || E'\\n' || $2) WHERE id = $1`, [id, input.notes]);
  await exec(ctx, `UPDATE maintenance_tickets SET resolution = coalesce($2, resolution), cost = coalesce($3, cost), parts = coalesce($4, parts) WHERE id = $1`, [
    id, input.resolution?.trim() ?? null, input.cost ?? null, input.parts ? json(cleanParts(input.parts)) : null,
  ]);
  const units = await ticketUnits(ctx, tk);
  await finish(ctx, tk, 'done', outcome, input.resolution || input.notes || t('maintenance.resolved_reason'));
  // A service ticket records the service: the next one is due from now.
  if (tk.service_interval_id && outcome === 'available')
    for (const u of units) await recordServiceEvent(ctx, u, { interval_id: tk.service_interval_id, ticket_id: id, notes: input.resolution });
  await audit(ctx, { entity_type: 'maintenance_ticket', entity_id: id, action: 'resolve', extra: { outcome } });
  const api = await getTicket(ctx, id);
  await emit(ctx, 'maintenance_ticket.resolved', { type: 'maintenance_ticket', id }, api);
  // Kept for one release for integrations listening to the old name.
  await emit(ctx, 'maintenance_ticket.closed', { type: 'maintenance_ticket', id }, api);
  return api;
}

/** Kept for one release: `close` is `resolve`. */
export async function closeTicket(ctx: Ctx, id: string, input: { outcome: 'available' | 'retired'; notes?: string }) {
  return resolveTicket(ctx, id, { outcome: input.outcome, notes: input.notes });
}

/** Not needed after all (opened by mistake, a false alarm): the units go back into service without a repair. */
export async function cancelTicket(ctx: Ctx, id: string, input: { reason?: string } = {}) {
  const tk = await openRow(ctx, id);
  if (input.reason) await exec(ctx, `UPDATE maintenance_tickets SET resolution = $2 WHERE id = $1`, [id, input.reason.trim()]);
  await finish(ctx, tk, 'cancelled', 'available', input.reason || t('maintenance.cancelled_reason'));
  await audit(ctx, { entity_type: 'maintenance_ticket', entity_id: id, action: 'cancel', extra: { reason: input.reason ?? null } });
  const api = await getTicket(ctx, id);
  await emit(ctx, 'maintenance_ticket.cancelled', { type: 'maintenance_ticket', id }, api);
  return api;
}
