import { t as msg } from '../i18n/index.ts';
import type { FieldError } from '../errors.ts';
import type { OpeningHours } from '../tenancy/settings.ts';
import { WEEKDAY_KEYS, hhmm, minutesBetween, zonedParts } from '../time.ts';

export interface BookingProduct {
  min_duration_min: number | null;
  max_duration_min: number | null;
  min_notice_min: number;
  increment_min: number | null;
}

export interface BookingLocation {
  timezone: string;
  opening_hours: OpeningHours;
}

export interface Blackout {
  starts_at: Date;
  ends_at: Date;
  reason?: string | null;
}

export function isOpenAt(loc: BookingLocation, at: Date): boolean {
  const p = zonedParts(at, loc.timezone);
  const key = WEEKDAY_KEYS[p.weekday]!;
  const intervals = loc.opening_hours?.[key] ?? [];
  const m = p.hour * 60 + p.minute;
  // Opening hours with no entries at all mean "always open" (e.g. self-service lockers).
  if (!loc.opening_hours || Object.keys(loc.opening_hours).length === 0) return true;
  return intervals.some(([a, b]) => m >= hhmm(a) && m <= hhmm(b));
}

export function inBlackout(blackouts: Blackout[], at: Date): Blackout | undefined {
  return blackouts.find((b) => at >= b.starts_at && at < b.ends_at);
}

/** Booking constraints of FR-AV-4. Returns field errors; empty means valid. */
export function checkBookingRules(
  product: BookingProduct,
  loc: BookingLocation,
  blackouts: Blackout[],
  startsAt: Date,
  endsAt: Date,
  now: Date,
  opts: { enforceHours: boolean; enforceNotice: boolean },
): FieldError[] {
  const errors: FieldError[] = [];
  const dur = minutesBetween(startsAt, endsAt);
  if (dur <= 0) errors.push({ field: 'ends_at', code: 'invalid_range', message: msg('error.the_return_must_be_after_the_pickup') });
  if (product.min_duration_min && dur < product.min_duration_min)
    errors.push({ field: 'ends_at', code: 'below_min_duration', message: msg('rules.min_duration', { minutes: product.min_duration_min }) });
  if (product.max_duration_min && dur > product.max_duration_min)
    errors.push({ field: 'ends_at', code: 'above_max_duration', message: msg('rules.max_duration', { minutes: product.max_duration_min }) });
  if (product.increment_min && Math.round(dur) % product.increment_min !== 0)
    errors.push({ field: 'ends_at', code: 'invalid_increment', message: msg('rules.increment', { minutes: product.increment_min }) });
  if (opts.enforceNotice && minutesBetween(now, startsAt) < (product.min_notice_min ?? 0))
    errors.push({ field: 'starts_at', code: 'below_min_notice', message: msg('rules.min_notice', { minutes: product.min_notice_min }) });
  if (opts.enforceNotice && startsAt < now) errors.push({ field: 'starts_at', code: 'in_past', message: msg('error.field.the_pickup_time_is_in_the_past') });
  if (opts.enforceHours) {
    if (!isOpenAt(loc, startsAt)) errors.push({ field: 'starts_at', code: 'location_closed', message: msg('error.field.the_shop_is_closed_at_the_pickup') });
    if (!isOpenAt(loc, endsAt)) errors.push({ field: 'ends_at', code: 'location_closed', message: msg('error.field.the_shop_is_closed_at_the_return') });
    const b1 = inBlackout(blackouts, startsAt);
    if (b1) errors.push({ field: 'starts_at', code: 'blackout', message: b1.reason || msg('rules.closed_pickup') });
    const b2 = inBlackout(blackouts, endsAt);
    if (b2) errors.push({ field: 'ends_at', code: 'blackout', message: b2.reason || msg('rules.closed_return') });
  }
  return errors;
}
