import type { Ctx } from '../context.ts';
import { t } from '../i18n/index.ts';
import { must, one } from '../sql.ts';

/** Text in an iCalendar value: backslash, semicolon, comma and line breaks escaped (RFC 5545 §3.3.11). */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (parts.length ? 74 : 75), bytes.length);
    // Never split a UTF-8 character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n ');
}

/**
 * A calendar file with the booking's pickup and return (30 minutes each, at the location), for the
 * customer's calendar: attached to the confirmation email and offered on the order page.
 */
export async function orderCalendar(ctx: Ctx, orderId: string, locale?: string | null) {
  const o = await must<any>(ctx, `SELECT id, number, starts_at, ends_at, location_id, public_token FROM orders WHERE id = $1`, [orderId], 'order', orderId);
  const shop = await must<{ name: string; locale: string }>(ctx, `SELECT name, locale FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const loc = await one<any>(ctx, `SELECT name, address FROM locations WHERE id = $1`, [o.location_id]);
  const l = locale ?? shop.locale;
  const a = loc?.address ?? {};
  const where = [loc?.name, a.line1, [a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ');
  const now = stamp(ctx.now);
  const event = (key: 'pickup' | 'return', at: Date) => [
    'BEGIN:VEVENT',
    `UID:${o.id}-${key}@openrent`,
    `DTSTAMP:${now}`,
    `DTSTART:${stamp(at)}`,
    `DTEND:${stamp(new Date(at.getTime() + 30 * 60_000))}`,
    `SUMMARY:${text(t(`calendar.${key}_title`, { number: o.number, shop: shop.name }, l))}`,
    ...(where ? [`LOCATION:${text(where)}`] : []),
    'END:VEVENT',
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenRent//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...event('pickup', new Date(o.starts_at)), ...event('return', new Date(o.ends_at)), 'END:VCALENDAR'];
  return { filename: `booking-${o.number}.ics`, content: Buffer.from(lines.map(fold).join('\r\n') + '\r\n', 'utf8'), where, number: o.number as number, starts_at: o.starts_at as string, ends_at: o.ends_at as string };
}
