/** Time-zone maths without external dependencies (Intl only). All instants are UTC Dates. */

export const MINUTE = 60_000;
export const DAY_MIN = 1440;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

export function zonedParts(d: Date, tz: string): ZonedParts {
  const parts = fmt(tz).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** Offset of tz from UTC at instant d, in milliseconds. */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = zonedParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** UTC instant of a local wall-clock time in tz (DST-safe for non-ambiguous times). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let off = tzOffsetMs(new Date(guess), tz);
  let t = guess - off;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off) {
    off = off2;
    t = guess - off;
  }
  return new Date(t);
}

/** `YYYY-MM-DD` of instant d in tz. */
export function localDate(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function parseLocalDate(s: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`invalid date ${s}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Start of the local day (midnight) containing `YYYY-MM-DD` in tz. */
export function startOfLocalDay(date: string, tz: string): Date {
  const { year, month, day } = parseLocalDate(date);
  return zonedTimeToUtc(year, month, day, 0, 0, tz);
}

export function addLocalDays(date: string, n: number): string {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(month: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`invalid month ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${m[1]}-${m[2]}-${String(i + 1).padStart(2, '0')}`);
}

export const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / MINUTE;
export const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * MINUTE);

/** "HH:MM" → minutes since midnight. */
export function hhmm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
