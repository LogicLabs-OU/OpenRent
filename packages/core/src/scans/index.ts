import { t as msg } from '../i18n/index.ts';
import type { Ctx } from '../context.ts';
import { many, one } from '../sql.ts';

export type ScanMode = 'lookup' | 'prepare' | 'check_out' | 'check_in' | 'stock_take' | 'receive';

/**
 * POST /scans: resolves a scanned code to an entity and suggests the next action (FR-SCAN-3, FR-SCAN-4).
 * Codes: stock item barcode, bulk stock-level barcode, order number (#1042), order QR (openrent:order:<token>).
 */
export async function resolveScan(ctx: Ctx, input: { code: string; mode?: ScanMode; order_id?: string }) {
  const code = input.code.trim();
  const mode = input.mode ?? 'lookup';
  const qr = /^openrent:order:(.+)$/.exec(code) ?? /\/order\/([A-Za-z0-9_-]{16,})\/?$/.exec(code);
  if (qr) {
    const o = await one(ctx, `SELECT id, number, status FROM orders WHERE public_token = $1`, [qr[1]]);
    if (o) return { code, mode, entity_type: 'order', entity: o, suggested_action: suggestForOrder(o.status) };
  }
  const num = /^#?(\d{1,9})$/.exec(code);
  if (num) {
    const o = await one(ctx, `SELECT id, number, status FROM orders WHERE number = $1`, [Number(num[1])]);
    if (o) return { code, mode, entity_type: 'order', entity: o, suggested_action: suggestForOrder(o.status) };
  }
  const unit = await one(
    ctx,
    `SELECT s.id, s.barcode, s.serial, s.status, s.variant_id, p.name AS product_name, v.name AS variant_name,
            (SELECT o.id FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id JOIN orders o ON o.id = l.order_id
              WHERE u.stock_item_id = s.id AND u.checked_in_at IS NULL AND o.status NOT IN ('closed','cancelled','expired') ORDER BY o.starts_at LIMIT 1) AS current_order_id,
            (SELECT tl.transfer_id FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
              WHERE tl.stock_item_id = s.id AND t.status = 'in_transit' AND tl.received_quantity + tl.lost_quantity < tl.quantity LIMIT 1) AS transfer_id
       FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.barcode = $1`,
    [code],
  );
  if (unit) {
    // A case (FR-CAT-11) shows what it holds; at a return it stands for the order its contents are out on.
    const contents = await many(
      ctx,
      `SELECT s.id, s.barcode, s.serial, s.status, p.name AS product_name, v.name AS variant_name FROM stock_items s
         JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.container_id = $1 ORDER BY p.name, s.barcode`,
      [unit.id],
    );
    unit.container_barcode = (await one<{ barcode: string }>(ctx, `SELECT c.barcode FROM stock_items c JOIN stock_items s ON s.container_id = c.id WHERE s.id = $1`, [unit.id]))?.barcode ?? null;
    unit.contents = contents;
    if (contents.length && !unit.current_order_id) {
      unit.current_order_id = (await one<{ id: string }>(
        ctx,
        `SELECT o.id FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id JOIN orders o ON o.id = l.order_id
          WHERE u.stock_item_id = ANY($1) AND u.checked_out_at IS NOT NULL AND u.checked_in_at IS NULL ORDER BY o.starts_at LIMIT 1`,
        [contents.map((c: any) => c.id)],
      ))?.id ?? null;
    }
    let suggested: string | null = null;
    if (unit.transfer_id && (mode === 'receive' || mode === 'lookup')) suggested = 'receive';
    else if (mode === 'check_in' || unit.status === 'out') suggested = 'check_in';
    else if (mode === 'prepare' || mode === 'check_out') suggested = input.order_id ? 'assign_units' : null;
    else if (unit.status === 'needs_inspection') suggested = 'inspect';
    return { code, mode, entity_type: 'stock_item', entity: unit, suggested_action: suggested };
  }
  const bulk = await one(
    ctx,
    `SELECT sl.variant_id, sl.location_id, sl.quantity, p.name AS product_name, v.name AS variant_name FROM stock_levels sl
       JOIN variants v ON v.id = sl.variant_id JOIN products p ON p.id = v.product_id WHERE sl.barcode = $1`,
    [code],
  );
  if (bulk) return { code, mode, entity_type: 'stock_level', entity: bulk, suggested_action: mode === 'check_out' ? 'confirm_quantity' : null };
  const customer = await one(ctx, `SELECT id, name, email, phone FROM customers WHERE deleted_at IS NULL AND (lower(email) = lower($1) OR regexp_replace(coalesce(phone,''), '[^0-9+]', '', 'g') = regexp_replace($1, '[^0-9+]', '', 'g')) LIMIT 1`, [code]);
  if (customer) return { code, mode, entity_type: 'customer', entity: customer, suggested_action: null };
  return { code, mode, entity_type: null, entity: null, suggested_action: null, error: { code: 'not_found', message: msg('scan.not_found', { code }) } };
}

function suggestForOrder(status: string): string | null {
  return ({ reserved: 'check_out', prepared: 'check_out', out: 'check_in', returned_partial: 'check_in', returned: 'inspect', quote: 'reserve', draft: 'reserve' } as Record<string, string>)[status] ?? null;
}

/** Global search for the command palette: orders, customers, products, units. */
export async function search(ctx: Ctx, q: string) {
  const like = `%${q.trim()}%`;
  const num = /^#?(\d+)$/.exec(q.trim());
  const orders = await (await import('../sql.ts')).many(
    ctx,
    `SELECT o.id, o.number, o.status, c.name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE ($2::int IS NOT NULL AND o.number = $2) OR c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1 ORDER BY o.created_at DESC LIMIT 8`,
    [like, num ? Number(num[1]) : null],
  );
  const { many } = await import('../sql.ts');
  const customers = await many(ctx, `SELECT id, name, email, phone FROM customers WHERE deleted_at IS NULL AND merged_into_id IS NULL AND (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 6`, [like]);
  const products = await many(ctx, `SELECT id, name, slug, type FROM products WHERE deleted_at IS NULL AND (name ILIKE $1 OR slug ILIKE $1) ORDER BY name LIMIT 6`, [like]);
  const units = await many(ctx, `SELECT s.id, s.barcode, s.serial, s.status, p.name AS product_name FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.barcode ILIKE $1 OR s.serial ILIKE $1 LIMIT 6`, [like]);
  return { object: 'search_result', orders, customers, products, stock_items: units };
}
export { replayScans, type ReplayItem } from './replay.ts';
