import type { Ctx } from '../context.ts';
import { invalid, notFound } from '../errors.ts';
import { audit } from '../events.ts';
import { newId, randomToken, sha256 } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { exec, many, one } from '../sql.ts';

/**
 * Secret iCal feeds for staff calendars (FR-INT-2): every pickup and return in a window around now.
 * The URL is the only key, so it is shown once (like an API key) and can be revoked.
 */

const PAST_DAYS = 30;
const FUTURE_DAYS = 180;
const EVENT_MINUTES = 30;

export function feedToApi(f: any) {
  return {
    id: f.id,
    object: 'calendar_feed',
    name: f.name,
    location_id: f.location_id,
    location_name: f.location_name ?? null,
    stock_item_id: f.stock_item_id ?? null,
    stock_item_label: f.stock_item_label ?? null,
    created_at: f.created_at,
    last_used_at: f.last_used_at,
    revoked_at: f.revoked_at,
  };
}

const feedUrl = (ctx: Ctx, token: string) =>
  `${ctx.config.publicUrl.replace(/\/$/, '')}/api/v1/calendar/${token}.ics`;

export async function listFeeds(ctx: Ctx, stockItemId?: string | null) {
  const rows = await many(
    ctx,
    `SELECT f.*, l.name AS location_name, coalesce(s.barcode, s.serial) AS stock_item_label FROM calendar_feeds f
       LEFT JOIN locations l ON l.id = f.location_id LEFT JOIN stock_items s ON s.id = f.stock_item_id
      WHERE f.revoked_at IS NULL AND ($1::text IS NULL OR f.stock_item_id = $1) ORDER BY f.created_at DESC`,
    [stockItemId ?? null],
  );
  return rows.map(feedToApi);
}

export async function createFeed(ctx: Ctx, input: { name: string; location_id?: string | null; stock_item_id?: string | null }) {
  const name = input.name?.trim();
  if (!name)
    throw invalid(t('calendar.name_required'), [
      { field: 'name', code: 'required', message: t('calendar.name_required') },
    ]);
  if (
    input.location_id &&
    !(await one(ctx, `SELECT 1 FROM locations WHERE id = $1 AND deleted_at IS NULL`, [input.location_id]))
  ) {
    throw invalid(t('calendar.unknown_location'), [
      { field: 'location_id', code: 'not_found', message: t('calendar.unknown_location') },
    ]);
  }
  if (input.stock_item_id && !(await one(ctx, `SELECT 1 FROM stock_items WHERE id = $1`, [input.stock_item_id]))) {
    throw invalid(t('calendar.unknown_unit'), [{ field: 'stock_item_id', code: 'not_found', message: t('calendar.unknown_unit') }]);
  }
  const token = randomToken(24);
  const row = await one(
    ctx,
    `INSERT INTO calendar_feeds (id, tenant_id, name, location_id, stock_item_id, token_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [newId('cal'), ctx.tenantId, name.slice(0, 100), input.stock_item_id ? null : input.location_id || null, input.stock_item_id || null, sha256(token), ctx.actor.id],
  );
  await audit(ctx, {
    entity_type: 'calendar_feed',
    entity_id: row.id,
    action: 'create',
    extra: { name, location_id: input.location_id ?? null, stock_item_id: input.stock_item_id ?? null },
  });
  return { ...feedToApi(row), url: feedUrl(ctx, token) };
}

export async function revokeFeed(ctx: Ctx, id: string) {
  const row = await one(
    ctx,
    `UPDATE calendar_feeds SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING *`,
    [id],
  );
  if (!row) throw notFound('calendar_feed', id);
  await audit(ctx, { entity_type: 'calendar_feed', entity_id: id, action: 'revoke' });
  return feedToApi(row);
}

/** The live feed behind a URL token; call with system access (the token names the tenant). */
export async function feedByToken(db: Ctx['db'], token: string) {
  const r = await db.query<{ id: string; tenant_id: string; name: string; location_id: string | null; stock_item_id: string | null }>(
    `SELECT id, tenant_id, name, location_id, stock_item_id FROM calendar_feeds WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(token)],
  );
  return r.rows[0] ?? null;
}

export interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location: string;
  url: string;
}

/** Pickups and returns of active bookings from 30 days back to 180 days ahead. */
export async function feedEvents(
  ctx: Ctx,
  feed: { id: string; location_id: string | null; stock_item_id?: string | null },
): Promise<CalendarEvent[]> {
  const from = new Date(ctx.now.getTime() - PAST_DAYS * 86_400_000);
  const to = new Date(ctx.now.getTime() + FUTURE_DAYS * 86_400_000);
  if (feed.stock_item_id) {
    const events = await unitEvents(ctx, feed.stock_item_id, from, to);
    await exec(ctx, `UPDATE calendar_feeds SET last_used_at = now() WHERE id = $1`, [feed.id]);
    return events;
  }
  const orders = await many(
    ctx,
    `SELECT o.id, o.number, o.status, o.starts_at, o.ends_at, c.name AS customer, l.name AS location, l.address,
            (SELECT string_agg(ol.quantity || '× ' || ol.description, ', ' ORDER BY ol.position) FROM order_lines ol WHERE ol.order_id = o.id AND ol.parent_line_id IS NULL) AS items
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN locations l ON l.id = o.location_id
      WHERE o.status IN ('reserved', 'prepared', 'out', 'returned_partial') AND o.ends_at >= $1 AND o.starts_at <= $2 AND ($3::text IS NULL OR o.location_id = $3)
      ORDER BY o.starts_at LIMIT 2000`,
    [from.toISOString(), to.toISOString(), feed.location_id],
  );
  const admin = ctx.config.adminUrl.replace(/\/$/, '');
  const events: CalendarEvent[] = [];
  for (const o of orders) {
    const who = o.customer ?? t('calendar.walk_in');
    const where = [o.location, o.address?.line1, o.address?.city].filter(Boolean).join(', ');
    const url = `${admin}/orders/${o.id}`;
    const description = [o.items, url].filter(Boolean).join('\n');
    for (const kind of ['pickup', 'return'] as const) {
      // Only what is still to happen: a picked-up order shows its return only.
      if (kind === 'pickup' && !['reserved', 'prepared'].includes(o.status)) continue;
      const at = new Date(kind === 'pickup' ? o.starts_at : o.ends_at);
      if (at < from || at > to) continue;
      events.push({
        uid: `${o.id}-${kind}@openrent`,
        start: at,
        end: new Date(at.getTime() + EVENT_MINUTES * 60_000),
        summary: t(kind === 'pickup' ? 'calendar.pickup' : 'calendar.return', {
          number: o.number,
          customer: who,
          items: o.items ?? '',
        }),
        description,
        location: where,
        url,
      });
    }
  }
  await exec(ctx, `UPDATE calendar_feeds SET last_used_at = now() WHERE id = $1`, [feed.id]);
  return events;
}

/** One unit's bookings (with buffers left out) and downtime, each as one event over its whole span. */
async function unitEvents(ctx: Ctx, stockItemId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const rows = await many(
    ctx,
    `SELECT a.id, a.kind, lower(a.period) AS s, upper(a.period) AS e, o.id AS order_id, o.number, o.starts_at, o.ends_at, c.name AS customer, d.reason, l.name AS location
       FROM allocations a LEFT JOIN orders o ON o.id = a.order_id LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN downtimes d ON d.id = a.downtime_id LEFT JOIN locations l ON l.id = a.location_id
      WHERE a.stock_item_id = $1 AND a.period && tstzrange($2, $3, '[)') AND a.kind IN ('reservation', 'downtime')
      ORDER BY lower(a.period) LIMIT 2000`,
    [stockItemId, from.toISOString(), to.toISOString()],
  );
  const admin = ctx.config.adminUrl.replace(/\/$/, '');
  return rows.map((r) => {
    const booking = r.kind === 'reservation' && r.order_id;
    const start = new Date(booking ? r.starts_at : r.s);
    const end = new Date(booking ? r.ends_at : (r.e ?? to));
    const url = booking ? `${admin}/orders/${r.order_id}` : `${admin}/maintenance`;
    return {
      uid: `${r.id}@openrent`,
      start,
      end,
      summary: booking ? t('calendar.unit_booking', { number: r.number, customer: r.customer ?? t('calendar.walk_in') }) : t('calendar.unit_downtime', { reason: r.reason || '' }).trim(),
      description: url,
      location: r.location ?? '',
      url,
    };
  });
}

// --- iCalendar (RFC 5545) ----------------------------------------------------

/** Escapes TEXT values: backslash, semicolon, comma and line breaks. */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

export function toIcs(name: string, events: CalendarEvent[], now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenRent//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      `DESCRIPTION:${icsText(e.description)}`,
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      `URL:${e.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
