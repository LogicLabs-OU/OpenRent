import type { OpeningHours } from '@openrent/theme-sdk';

const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function parts(t: number, tz: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
}

export function makeZone(tz: string, hours: OpeningHours) {
  const toInstant = (date: string, time: string) => {
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const guess = Date.UTC(y!, m! - 1, d!, h!, mi!);
    const off = (t: number) => {
      const p = parts(t, tz);
      return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - t;
    };
    let t = guess - off(guess);
    t = guess - off(t);
    return new Date(t).toISOString();
  };
  const localDate = (iso: string) => {
    const p = parts(Date.parse(iso), tz);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  };
  const localTime = (iso: string) => {
    const p = parts(Date.parse(iso), tz);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  };
  /** Pickup/return times inside opening hours for that local date (FR-SF-5). */
  const timeOptions = (date: string, step = 30) => {
    const wd = new Date(date + 'T12:00:00Z').getUTCDay();
    const always = !hours || Object.keys(hours).length === 0;
    const intervals = always ? [['00:00', '23:30']] : hours[KEYS[wd]!] ?? [];
    const out: string[] = [];
    for (const [a, b] of intervals) {
      const [ah, am] = a!.split(':').map(Number);
      const [bh, bm] = b!.split(':').map(Number);
      for (let m = ah! * 60 + am!; m <= bh! * 60 + bm!; m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    return out;
  };
  return { toInstant, localDate, localTime, timeOptions };
}
