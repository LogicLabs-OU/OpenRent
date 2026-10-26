import type { Ctx } from '../context.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, many, one } from '../sql.ts';

/** The open ticket a unit is on, as its main unit or one of the others. */
export async function openTicketOf(ctx: Ctx, stockItemId: string) {
  return one<{ id: string; severity: string }>(
    ctx,
    `SELECT m.id, m.severity FROM maintenance_tickets m
      WHERE m.status NOT IN ('done','cancelled')
        AND (m.stock_item_id = $1 OR EXISTS (SELECT 1 FROM maintenance_ticket_units u WHERE u.ticket_id = m.id AND u.stock_item_id = $1 AND u.released_at IS NULL))
      LIMIT 1`,
    [stockItemId],
  );
}

/**
 * Opens a ticket for a unit going out of service, or adds the new reason to its open ticket.
 * Kept free of inventory imports so setStockItemStatus can call it.
 */
export async function ensureTicket(ctx: Ctx, stockItemId: string, severity: 'soft_down' | 'hard_down', reason: string, orderId?: string | null) {
  const open = await openTicketOf(ctx, stockItemId);
  if (open) {
    await exec(ctx, `UPDATE maintenance_tickets SET severity = CASE WHEN $2 = 'hard_down' THEN 'hard_down' ELSE severity END, notes = trim(notes || E'\\n' || $3) WHERE id = $1`, [open.id, severity, reason]);
    return open.id;
  }
  const unit = await one<{ barcode: string; product: string }>(ctx, `SELECT s.barcode, p.name AS product FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.id = $1`, [stockItemId]);
  const id = newId('mtk');
  const row = (
    await many(
      ctx,
      `INSERT INTO maintenance_tickets (id, tenant_id, stock_item_id, severity, title, notes, created_from_order_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, ctx.tenantId, stockItemId, severity, `${unit?.product ?? ''} ${unit?.barcode ?? ''}`.trim(), reason ?? '', orderId ?? null, ctx.actor.id],
    )
  )[0];
  await audit(ctx, { entity_type: 'maintenance_ticket', entity_id: id, action: 'create', after: row });
  await emit(ctx, 'maintenance_ticket.created', { type: 'maintenance_ticket', id }, { id, object: 'maintenance_ticket', stock_item_id: stockItemId, severity });
  return id;
}

/**
 * A unit is back in service (or gone) without its ticket being resolved: it leaves the ticket, and a
 * ticket with no unit left out of service is done.
 */
export async function releaseUnit(ctx: Ctx, stockItemId: string) {
  await exec(ctx, `UPDATE maintenance_ticket_units SET released_at = $2 WHERE stock_item_id = $1 AND released_at IS NULL`, [stockItemId, ctx.now]);
  await exec(
    ctx,
    `UPDATE maintenance_tickets m SET status = 'done', closed_at = $2
      WHERE m.status NOT IN ('done','cancelled')
        AND (m.stock_item_id = $1 OR EXISTS (SELECT 1 FROM maintenance_ticket_units u WHERE u.ticket_id = m.id AND u.stock_item_id = $1))
        AND NOT EXISTS (
          SELECT 1 FROM stock_items s WHERE s.id <> $1 AND s.status IN ('needs_inspection','soft_down','hard_down')
             AND (s.id = m.stock_item_id OR s.id IN (SELECT u.stock_item_id FROM maintenance_ticket_units u WHERE u.ticket_id = m.id AND u.released_at IS NULL)))`,
    [stockItemId, ctx.now],
  );
}
