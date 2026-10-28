import type { Ctx } from '../context.ts';
import { t as msg } from '../i18n/index.ts';
import { AppError, invalid, notFound } from '../errors.ts';
import { audit } from '../events.ts';
import { newId, randomToken, sha256 } from '../ids.ts';
import { exec, many, must, one } from '../sql.ts';
import { assignUnits, runAction } from '../orders/index.ts';
import { isPluginEnabled } from '../plugins/index.ts';
import type { TagRead } from '@openrent/plugin-sdk';

/**
 * RFID (FR-SCAN-7): units carry one or more EPC tags; a fixed or handheld reader, through a bridge,
 * posts what it reads to its own address; the scan page takes every unit read at once. A unit read
 * twice counts once, and tags no unit has are listed for staff to look at.
 */

/** An EPC as readers send it: hex, any case, maybe with spaces, dashes or colons. */
export function normalizeEpc(raw: string): string | null {
  const s = String(raw ?? '').replace(/[\s:-]/g, '').toUpperCase();
  return /^[0-9A-F]{8,64}$/.test(s) ? s : null;
}

// --- Formats ---------------------------------------------------------------------------------------------

const OWN_FORMAT = 'openrent';

/** Formats a reader may post in: OpenRent's own JSON, and those of RFID plugins the shop has on. */
export async function readerFormats(ctx: Ctx) {
  const out: { id: string; name: Record<string, string> }[] = [{ id: OWN_FORMAT, name: Object.fromEntries(['en', 'de', 'fr', 'es', 'et', 'ja', 'nl'].map((l) => [l, msg('rfid.format_openrent', {}, l as any)])) }];
  for (const { pluginId, reader } of ctx.plugins.tagReaders?.() ?? []) if (await isPluginEnabled(ctx, pluginId)) out.push({ id: reader.id, name: reader.name as Record<string, string> });
  return out;
}

/**
 * The reads in one posting. OpenRent's own format is JSON: `{"reads": [{"epc", "read_at", "antenna", "rssi"}]}`
 * or just `{"epcs": [...]}`. Other formats belong to plugins.
 */
export async function parseReads(ctx: Ctx, format: string, req: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): Promise<TagRead[]> {
  const text = req.rawBody.toString('utf8');
  const type = String(req.headers['content-type'] ?? '');
  let body: unknown = text;
  try {
    if (type.includes('json') || /^\s*[[{]/.test(text)) body = JSON.parse(text);
    else if (type.includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(text));
  } catch {
    body = text;
  }
  if (format === OWN_FORMAT) {
    const b = body as any;
    if (Array.isArray(b?.reads)) return b.reads.filter((r: any) => typeof r?.epc === 'string');
    if (Array.isArray(b?.epcs)) return b.epcs.filter((e: unknown) => typeof e === 'string').map((epc: string) => ({ epc }));
    return [];
  }
  const hit = (ctx.plugins.tagReaders?.() ?? []).find((x) => x.reader.id === format);
  if (!hit || !(await isPluginEnabled(ctx, hit.pluginId))) return [];
  return hit.reader.parse({ headers: req.headers, body, rawBody: req.rawBody }) ?? [];
}

// --- Tags on units --------------------------------------------------------------------------------------

export async function unitTags(ctx: Ctx, stockItemId: string) {
  return (await many<{ epc: string }>(ctx, `SELECT epc FROM rfid_tags WHERE stock_item_id = $1 ORDER BY created_at, epc`, [stockItemId])).map((r) => r.epc);
}

/** Replaces the unit's tags. A tag on another unit is refused by field, so staff can see which. */
export async function setUnitTags(ctx: Ctx, stockItemId: string, input: { epcs: string[] }) {
  await must(ctx, `SELECT id FROM stock_items WHERE id = $1`, [stockItemId], 'stock_item', stockItemId);
  const errors: { field: string; code: string; message: string }[] = [];
  const epcs: string[] = [];
  (input.epcs ?? []).slice(0, 20).forEach((raw, i) => {
    const epc = normalizeEpc(raw);
    if (!epc) errors.push({ field: `epcs.${i}`, code: 'invalid', message: msg('rfid.invalid_epc') });
    else if (!epcs.includes(epc)) epcs.push(epc);
  });
  if ((input.epcs ?? []).length > 20) errors.push({ field: 'epcs', code: 'too_many', message: msg('rfid.too_many_tags') });
  const taken = epcs.length
    ? await many<{ epc: string; barcode: string }>(ctx, `SELECT t.epc, s.barcode FROM rfid_tags t JOIN stock_items s ON s.id = t.stock_item_id WHERE t.epc = ANY($1) AND t.stock_item_id <> $2`, [epcs, stockItemId])
    : [];
  for (const x of taken) errors.push({ field: `epcs.${(input.epcs ?? []).findIndex((r) => normalizeEpc(r) === x.epc)}`, code: 'taken', message: msg('rfid.tag_taken', { barcode: x.barcode }) });
  if (errors.length) throw invalid(msg('rfid.tags_invalid'), errors);
  const before = await unitTags(ctx, stockItemId);
  await exec(ctx, `DELETE FROM rfid_tags WHERE stock_item_id = $1 AND NOT (epc = ANY($2))`, [stockItemId, epcs]);
  for (const epc of epcs) await exec(ctx, `INSERT INTO rfid_tags (id, tenant_id, epc, stock_item_id) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, epc) DO NOTHING`, [newId('rft'), ctx.tenantId, epc, stockItemId]);
  await audit(ctx, { entity_type: 'stock_item', entity_id: stockItemId, action: 'rfid_tags', before: { epcs: before }, after: { epcs } });
  return { object: 'rfid_tags', stock_item_id: stockItemId, epcs };
}

/** Which units the tags belong to; the rest are unknown. Repeats count once. */
export async function resolveTags(ctx: Ctx, raw: string[]) {
  const epcs = [...new Set(raw.map(normalizeEpc).filter((e): e is string => !!e))];
  const rows = epcs.length
    ? await many<any>(
        ctx,
        `SELECT t.epc, s.id, s.barcode, s.status, s.variant_id, p.name AS product_name, v.name AS variant_name,
                (SELECT o.id FROM order_line_units u JOIN order_lines l ON l.id = u.order_line_id JOIN orders o ON o.id = l.order_id
                  WHERE u.stock_item_id = s.id AND u.checked_out_at IS NOT NULL AND u.checked_in_at IS NULL ORDER BY o.starts_at LIMIT 1) AS current_order_id
           FROM rfid_tags t JOIN stock_items s ON s.id = t.stock_item_id JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
          WHERE t.epc = ANY($1)`,
        [epcs],
      )
    : [];
  const byEpc = new Map(rows.map((r) => [r.epc, r]));
  // A unit with two tags read is still one unit.
  const units = new Map<string, any>();
  for (const r of rows) if (!units.has(r.id)) units.set(r.id, { id: r.id, barcode: r.barcode, status: r.status, product_name: r.product_name, variant_name: r.variant_name, current_order_id: r.current_order_id, epcs: [] as string[] });
  for (const r of rows) units.get(r.id).epcs.push(r.epc);
  return { units: [...units.values()], unknown: epcs.filter((e) => !byEpc.has(e)), invalid: raw.filter((e) => !normalizeEpc(e)).slice(0, 50) };
}

/**
 * Takes every unit the tags belong to at once: at pickup onto the order's lines (as far as they fit),
 * at return back from whichever order each is out on. Each unit is reported as done or why not.
 */
export async function scanTags(ctx: Ctx, input: { epcs: string[]; mode: 'check_out' | 'check_in'; order_id?: string | null }) {
  if (!Array.isArray(input.epcs) || !input.epcs.length || input.epcs.length > 2000)
    throw invalid(msg('rfid.send_tags'), [{ field: 'epcs', code: 'invalid', message: msg('rfid.send_tags') }]);
  const { units, unknown } = await resolveTags(ctx, input.epcs);
  const results: { barcode: string; product_name: string; status: 'applied' | 'skipped'; message: string; order_id?: string | null }[] = [];
  if (input.mode === 'check_out') {
    if (!input.order_id) throw invalid(msg('rfid.order_required'), [{ field: 'order_id', code: 'required', message: msg('rfid.order_required') }]);
    if (units.length) {
      try {
        const r: any = await assignUnits(ctx, input.order_id, { stock_item_ids: units.map((u) => u.id), partial: true });
        const skipped = new Map<string, string>((r.skipped ?? []).map((s: any) => [s.barcode, s.reason]));
        const assigned = new Set<string>(r.assigned ?? []);
        for (const u of units) {
          const status = assigned.has(u.barcode) ? ('applied' as const) : ('skipped' as const);
          // Neither taken nor refused: the unit is on the order already (read again).
          results.push({ barcode: u.barcode, product_name: u.product_name, order_id: input.order_id, status, message: assigned.has(u.barcode) ? msg('rfid.assigned') : (skipped.get(u.barcode) ?? msg('rfid.already_on_order')) });
        }
      } catch (e) {
        if (!(e instanceof AppError) || e.code !== 'wrong_item') throw e;
        const skipped: any[] = (e as any).extra?.skipped ?? [];
        for (const u of units) results.push({ barcode: u.barcode, product_name: u.product_name, status: 'skipped', message: skipped.find((s) => s.barcode === u.barcode)?.reason ?? e.message });
      }
    }
  } else {
    // Back from each order the units are out on, one return per order.
    const byOrder = new Map<string, any[]>();
    for (const u of units) {
      if (!u.current_order_id) results.push({ barcode: u.barcode, product_name: u.product_name, status: 'skipped', message: msg('rfid.not_out') });
      else byOrder.set(u.current_order_id, [...(byOrder.get(u.current_order_id) ?? []), u]);
    }
    for (const [orderId, list] of byOrder) {
      await ctx.db.query('SAVEPOINT rfid_check_in');
      try {
        const o: any = await runAction(ctx, orderId, 'check_in', { units: list.map((u) => ({ barcode: u.barcode, outcome: 'ok' })) });
        await ctx.db.query('RELEASE SAVEPOINT rfid_check_in');
        for (const u of list) results.push({ barcode: u.barcode, product_name: u.product_name, status: 'applied', message: msg('scan.checked_in_unit', { code: u.barcode, number: o.number }), order_id: orderId });
      } catch (e) {
        await ctx.db.query('ROLLBACK TO SAVEPOINT rfid_check_in');
        if (!(e instanceof AppError)) throw e;
        for (const u of list) results.push({ barcode: u.barcode, product_name: u.product_name, status: 'skipped', message: e.message, order_id: orderId });
      }
    }
  }
  return {
    object: 'tag_scan',
    mode: input.mode,
    results,
    applied: results.filter((r) => r.status === 'applied').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    unknown,
  };
}

// --- Readers ---------------------------------------------------------------------------------------------

export function readerToApi(r: any) {
  return { id: r.id, object: 'rfid_reader', name: r.name, location_id: r.location_id, format: r.format, last_read_at: r.last_read_at, created_at: r.created_at };
}

export const readerUrl = (ctx: Ctx, id: string) => `${ctx.config.publicUrl.replace(/\/$/, '')}/webhooks/rfid/${id}`;

export async function listReaders(ctx: Ctx) {
  return (await many(ctx, `SELECT * FROM rfid_readers WHERE revoked_at IS NULL ORDER BY name, id`)).map(readerToApi);
}

/** A reader (or its bridge) gets an address and a token to post reads with; the token is shown once. */
export async function createReader(ctx: Ctx, input: { name: string; location_id?: string | null; format?: string }) {
  const formats = (await readerFormats(ctx)).map((f) => f.id);
  const name = String(input.name ?? '').trim().slice(0, 100);
  const errors: { field: string; code: string; message: string }[] = [];
  if (!name) errors.push({ field: 'name', code: 'required', message: msg('rfid.reader_name_required') });
  const format = input.format ?? OWN_FORMAT;
  if (!formats.includes(format)) errors.push({ field: 'format', code: 'invalid', message: msg('rfid.unknown_format') });
  if (input.location_id && !(await one(ctx, `SELECT 1 FROM locations WHERE id = $1 AND deleted_at IS NULL`, [input.location_id]))) errors.push({ field: 'location_id', code: 'not_found', message: msg('calendar.unknown_location') });
  if (errors.length) throw invalid(msg('rfid.reader_invalid'), errors);
  const token = randomToken(24);
  const row = await one(ctx, `INSERT INTO rfid_readers (id, tenant_id, name, location_id, format, token_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
    newId('rfr'), ctx.tenantId, name, input.location_id ?? null, format, sha256(token), ctx.actor.id,
  ]);
  await audit(ctx, { entity_type: 'rfid_reader', entity_id: row.id, action: 'create', extra: { name, format } });
  return { ...readerToApi(row), token, url: readerUrl(ctx, row.id) };
}

export async function revokeReader(ctx: Ctx, id: string) {
  const row = await one(ctx, `UPDATE rfid_readers SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING *`, [id, ctx.now]);
  if (!row) throw notFound('rfid_reader', id);
  await audit(ctx, { entity_type: 'rfid_reader', entity_id: id, action: 'revoke' });
  return { ...readerToApi(row), deleted: true };
}

/** The reader a posting belongs to, if its token is right (system context: the post has no session). */
export async function readerForToken(ctx: Pick<Ctx, 'db'>, id: string, token: string) {
  const r = await one<any>(ctx, `SELECT * FROM rfid_readers WHERE id = $1 AND revoked_at IS NULL`, [id]);
  return r && token && r.token_hash === sha256(token) ? r : null;
}

/** Keeps what a reader read. A tag read again within a second of its last read is the same read. */
export async function storeReads(ctx: Ctx, reader: { id: string }, reads: TagRead[]) {
  let kept = 0;
  for (const r of reads.slice(0, 5000)) {
    const epc = normalizeEpc(r.epc);
    if (!epc) continue;
    const at = r.read_at && !Number.isNaN(Date.parse(r.read_at)) && Math.abs(Date.parse(r.read_at) - ctx.now.getTime()) < 86_400_000 ? new Date(r.read_at) : ctx.now;
    const n = await exec(
      ctx,
      `INSERT INTO rfid_reads (id, tenant_id, reader_id, epc, read_at, antenna, rssi, created_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM rfid_reads WHERE reader_id = $3 AND epc = $4 AND read_at > $5::timestamptz - interval '1 second' AND read_at <= $5)`,
      [newId('rfd'), ctx.tenantId, reader.id, epc, at, Number.isInteger(r.antenna) ? r.antenna : null, Number.isFinite(r.rssi) ? r.rssi : null, ctx.now],
    );
    kept += n;
  }
  await exec(ctx, `UPDATE rfid_readers SET last_read_at = $2 WHERE id = $1`, [reader.id, ctx.now]);
  return kept;
}

/**
 * What reached OpenRent from the reader since `since` (the scan page asks each second while reading), with
 * the units. Without `since` it starts now: the answer's `since` is the server's time to ask from, so
 * neither the reader's clock nor the browser's matters.
 */
export async function readsSince(ctx: Ctx, readerId: string, since: string) {
  const reader = await must<any>(ctx, `SELECT * FROM rfid_readers WHERE id = $1 AND revoked_at IS NULL`, [readerId], 'rfid_reader', readerId);
  const from = Number.isNaN(Date.parse(since)) ? ctx.now : new Date(since);
  const rows = await many<{ epc: string; n: number; last: string }>(ctx, `SELECT epc, count(*)::int AS n, max(created_at) AS last FROM rfid_reads WHERE reader_id = $1 AND created_at >= $2 GROUP BY epc ORDER BY min(created_at)`, [readerId, from]);
  const resolved = await resolveTags(ctx, rows.map((r) => r.epc));
  return { object: 'rfid_reads', reader: readerToApi(reader), since: from.toISOString(), reads: rows.length, ...resolved };
}

/** Worker, nightly: reads older than a day are only noise. */
export async function purgeReads(ctx: Ctx) {
  return exec(ctx, `DELETE FROM rfid_reads WHERE read_at < $1`, [new Date(ctx.now.getTime() - 86_400_000)]);
}

