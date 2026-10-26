import type { Ctx } from '../context.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { exec, one } from '../sql.ts';

/** Records a service done on a unit (FR-MNT-4); the next one is due from now. Kept free of maintenance imports. */
export async function recordServiceEvent(ctx: Ctx, stockItemId: string, input: { interval_id: string; notes?: string; ticket_id?: string | null; performed_at?: string | null }) {
  const unit = await one<{ meter_value: number | null }>(ctx, `SELECT meter_value FROM stock_items WHERE id = $1`, [stockItemId]);
  const id = newId('sev');
  const at = input.performed_at ? new Date(input.performed_at) : ctx.now;
  await exec(
    ctx,
    `INSERT INTO service_events (id, tenant_id, stock_item_id, interval_id, performed_at, meter_value, ticket_id, notes, performed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, ctx.tenantId, stockItemId, input.interval_id, at, unit?.meter_value ?? null, input.ticket_id ?? null, input.notes?.trim() ?? '', ctx.actor.type === 'user' ? ctx.actor.id : null],
  );
  const event = { id, object: 'service_event', stock_item_id: stockItemId, interval_id: input.interval_id, performed_at: at.toISOString(), meter_value: unit?.meter_value ?? null, ticket_id: input.ticket_id ?? null, notes: input.notes?.trim() ?? '' };
  await audit(ctx, { entity_type: 'stock_item', entity_id: stockItemId, action: 'service', after: event });
  await emit(ctx, 'stock_item.serviced', { type: 'stock_item', id: stockItemId }, event);
  return event;
}
