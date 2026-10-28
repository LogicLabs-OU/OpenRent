import type { Ctx } from '../context.ts';
import { AppError, invalid, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { escapeHtml as esc } from '../format.ts';
import { json, many, must, one } from '../sql.ts';
import { createTicket } from '../maintenance/index.ts';
import { recordServiceEvent } from './events.ts';

/**
 * Electrical safety tests (PAT, FR-MNT-5). An interval of the kind `electrical_test` says which units need
 * one and how often. A passing test is the interval's service; a failing one takes the unit out of service
 * with a repair ticket. Pickup waits for a unit whose test has run out.
 */
const DAY = 86_400_000;

export interface ElectricalTestInput {
  tested_at?: string | null;
  result: 'pass' | 'fail';
  appliance_class?: 'I' | 'II' | 'III' | null;
  readings?: { earth_ohm?: number | null; insulation_mohm?: number | null; leakage_ma?: number | null; polarity_ok?: boolean | null; visual_ok?: boolean | null };
  tester: string;
  instrument?: string | null;
  notes?: string;
}

export function electricalTestToApi(r: any) {
  return {
    id: r.id, object: 'electrical_test', stock_item_id: r.stock_item_id, interval_id: r.interval_id, tested_at: r.tested_at, result: r.result, appliance_class: r.appliance_class,
    readings: r.readings ?? {}, tester: r.tester, instrument: r.instrument, notes: r.notes, next_due: r.next_due, ticket_id: r.ticket_id, created_at: r.created_at,
  };
}

/** The electrical test interval that applies to a unit: its product's, else its category's, else the shop's. */
async function intervalFor(ctx: Ctx, stockItemId: string) {
  return one<{ id: string; name: string; every_days: number }>(
    ctx,
    `SELECT si.id, si.name, si.every_days FROM service_intervals si
       JOIN stock_items s ON s.id = $1 JOIN variants v ON v.id = s.variant_id
      WHERE si.kind = 'electrical_test' AND si.active AND si.deleted_at IS NULL AND si.every_days > 0
        AND (si.product_id = v.product_id OR (si.product_id IS NULL AND (si.category_id IS NULL OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = v.product_id AND pc.category_id = si.category_id))))
      ORDER BY (si.product_id IS NOT NULL) DESC, (si.category_id IS NOT NULL) DESC, si.every_days LIMIT 1`,
    [stockItemId],
  );
}

/** Whether the unit needs a test, its last one, and until when it may go out. */
export async function electricalStatus(ctx: Ctx, stockItemId: string) {
  const iv = await intervalFor(ctx, stockItemId);
  const last = await one<any>(ctx, `SELECT * FROM electrical_tests WHERE stock_item_id = $1 ORDER BY tested_at DESC, created_at DESC LIMIT 1`, [stockItemId]);
  const lastPass = last?.result === 'pass' ? last : null;
  const validUntil = iv && lastPass ? new Date(new Date(lastPass.tested_at).getTime() + iv.every_days * DAY) : null;
  return {
    object: 'electrical_status',
    required: !!iv,
    interval: iv ? { id: iv.id, name: iv.name, every_days: iv.every_days } : null,
    last_test: last ? electricalTestToApi(last) : null,
    valid_until: validUntil?.toISOString() ?? null,
    // Required and no passing test that still counts (or the last test failed).
    expired: !!iv && (!validUntil || validUntil <= ctx.now),
  };
}

function check(input: ElectricalTestInput, now: Date) {
  const errors: FieldError[] = [];
  if (!['pass', 'fail'].includes(input.result)) errors.push({ field: 'result', code: 'invalid', message: msg('pat.result_required') });
  if (!String(input.tester ?? '').trim()) errors.push({ field: 'tester', code: 'required', message: msg('pat.tester_required') });
  if (input.appliance_class != null && !['I', 'II', 'III'].includes(input.appliance_class)) errors.push({ field: 'appliance_class', code: 'invalid', message: msg('pat.class_invalid') });
  const at = input.tested_at ? new Date(input.tested_at) : now;
  if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 5 * 60_000) errors.push({ field: 'tested_at', code: 'invalid', message: msg('pat.tested_at_invalid') });
  const r = input.readings ?? {};
  for (const k of ['earth_ohm', 'insulation_mohm', 'leakage_ma'] as const) {
    const v = r[k];
    if (v != null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000)) errors.push({ field: `readings.${k}`, code: 'invalid', message: msg('pat.reading_invalid') });
  }
  // Class I appliances are earthed: their test has an earth continuity reading.
  if (input.appliance_class === 'I' && input.result === 'pass' && r.earth_ohm == null) errors.push({ field: 'readings.earth_ohm', code: 'required', message: msg('pat.earth_required') });
  if (errors.length) throw invalid(msg('pat.invalid'), errors);
  return at;
}

export async function listElectricalTests(ctx: Ctx, stockItemId: string) {
  await must(ctx, `SELECT 1 FROM stock_items WHERE id = $1`, [stockItemId], 'stock_item', stockItemId);
  return (await many(ctx, `SELECT * FROM electrical_tests WHERE stock_item_id = $1 ORDER BY tested_at DESC, created_at DESC LIMIT 100`, [stockItemId])).map(electricalTestToApi);
}

export async function recordElectricalTest(ctx: Ctx, stockItemId: string, input: ElectricalTestInput) {
  const unit = await must<any>(ctx, `SELECT s.id, s.barcode, p.name AS product_name FROM stock_items s JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id WHERE s.id = $1`, [stockItemId], 'stock_item', stockItemId);
  const at = check(input, ctx.now);
  const iv = await intervalFor(ctx, stockItemId);
  const nextDue = iv && input.result === 'pass' ? new Date(at.getTime() + iv.every_days * DAY).toISOString().slice(0, 10) : null;
  let ticketId: string | null = null;
  if (input.result === 'fail') {
    // Unsafe until repaired and tested again.
    const ticket: any = await createTicket(ctx, { stock_item_ids: [stockItemId], title: msg('pat.ticket_title', { barcode: unit.barcode }), notes: String(input.notes ?? '').trim(), severity: 'hard_down', keep_in_service: false });
    ticketId = ticket?.id ?? null;
  }
  const row = await one(
    ctx,
    `INSERT INTO electrical_tests (id, tenant_id, stock_item_id, interval_id, tested_at, result, appliance_class, readings, tester, instrument, notes, next_due, ticket_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      newId('elt'), ctx.tenantId, stockItemId, iv?.id ?? null, at, input.result, input.appliance_class ?? null, json(input.readings ?? {}), String(input.tester).trim().slice(0, 120),
      input.instrument ? String(input.instrument).trim().slice(0, 120) : null, String(input.notes ?? '').trim().slice(0, 2000), nextDue, ticketId, ctx.actor.id,
    ],
  );
  if (iv && input.result === 'pass') await recordServiceEvent(ctx, stockItemId, { interval_id: iv.id, performed_at: at.toISOString(), notes: msg('pat.service_note') });
  const api = electricalTestToApi(row);
  await audit(ctx, { entity_type: 'stock_item', entity_id: stockItemId, action: 'electrical_test', after: api });
  await emit(ctx, 'stock_item.electrical_tested', { type: 'stock_item', id: stockItemId }, api);
  return api;
}

/** Units among these that need a test and have no valid one: they may not go out. */
export async function expiredUnits(ctx: Ctx, stockItemIds: string[]) {
  const out: { id: string; barcode: string }[] = [];
  for (const id of [...new Set(stockItemIds)]) {
    const s = await electricalStatus(ctx, id);
    if (s.expired) out.push({ id, barcode: (await one<{ barcode: string }>(ctx, `SELECT barcode FROM stock_items WHERE id = $1`, [id]))!.barcode });
  }
  return out;
}

export function electricalRefusal(units: { barcode: string }[]) {
  const message = msg('pat.expired', { barcodes: units.map((u) => u.barcode).join(', ') });
  return new AppError('electrical_test_expired', 409, message, { errors: units.map((u) => ({ field: 'units', code: 'electrical_test_expired', message: msg('pat.expired', { barcodes: u.barcode }) })), extra: { barcodes: units.map((u) => u.barcode) } });
}

/** A printable certificate of one test (HTML; the API turns it into a PDF where it can). */
export async function certificateHtml(ctx: Ctx, testId: string) {
  const r = await must<any>(
    ctx,
    `SELECT e.*, s.barcode, s.serial, p.name AS product_name, t.name AS shop_name, t.legal_name, t.timezone, t.locale
       FROM electrical_tests e JOIN stock_items s ON s.id = e.stock_item_id JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
       JOIN tenants t ON t.id = e.tenant_id WHERE e.id = $1`,
    [testId],
    'electrical_test',
    testId,
  );
  const l = r.locale ?? 'en';
  const date = (v: string | Date | null) => (v ? new Intl.DateTimeFormat(l, { dateStyle: 'long', timeZone: r.timezone }).format(new Date(v)) : '–');
  const num = (v: number | null | undefined, unit: string) => (v == null ? '–' : `${new Intl.NumberFormat(l, { maximumFractionDigits: 3 }).format(v)} ${unit}`);
  const yes = (v: boolean | null | undefined) => (v == null ? '–' : msg(v ? 'pat.ok' : 'pat.not_ok', {}, l));
  const rd = r.readings ?? {};
  const rows: [string, string][] = [
    [msg('pat.cert.item', {}, l), `${r.product_name} · ${r.barcode}${r.serial ? ` · ${r.serial}` : ''}`],
    [msg('pat.cert.tested_at', {}, l), date(r.tested_at)],
    [msg('pat.cert.class', {}, l), r.appliance_class ?? '–'],
    [msg('pat.cert.visual', {}, l), yes(rd.visual_ok)],
    [msg('pat.cert.earth', {}, l), num(rd.earth_ohm, 'Ω')],
    [msg('pat.cert.insulation', {}, l), num(rd.insulation_mohm, 'MΩ')],
    [msg('pat.cert.leakage', {}, l), num(rd.leakage_ma, 'mA')],
    [msg('pat.cert.polarity', {}, l), yes(rd.polarity_ok)],
    [msg('pat.cert.tester', {}, l), r.tester],
    [msg('pat.cert.instrument', {}, l), r.instrument ?? '–'],
    [msg('pat.cert.next_due', {}, l), date(r.next_due)],
  ];
  return `<!doctype html><html lang="${esc(l)}"><head><meta charset="utf-8"><title>${esc(msg('pat.cert.title', {}, l))} ${esc(r.barcode)}</title>
<style>body{font-family:system-ui,sans-serif;margin:40px;color:#111}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 24px;color:#555}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd;vertical-align:top}th{width:40%;font-weight:600}.result{font-size:18px;font-weight:700;margin:24px 0}.pass{color:#166534}.fail{color:#b91c1c}footer{margin-top:32px;font-size:12px;color:#555}</style></head>
<body><h1>${esc(msg('pat.cert.title', {}, l))}</h1><p>${esc(r.legal_name || r.shop_name)}</p>
<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<div class="result ${r.result}">${esc(msg(r.result === 'pass' ? 'pat.cert.pass' : 'pat.cert.fail', {}, l))}</div>
${r.notes ? `<p>${esc(r.notes)}</p>` : ''}<footer>${esc(r.id)}</footer></body></html>`;
}
