/**
 * Pickup and return are picked as wall-clock times in the shop's time zone (`2026-11-03T10:00`),
 * and the API takes UTC.
 */
function offsetMin(tz: string, at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - at.getTime()) / 60_000;
}

export function shopTimeToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  // Twice, so a time next to a daylight saving change lands on the right side of it.
  let t = wall - offsetMin(tz, new Date(wall)) * 60_000;
  t = wall - offsetMin(tz, new Date(t)) * 60_000;
  return new Date(Math.floor(t / 60_000) * 60_000).toISOString();
}

export function isoToShopTime(iso: string, tz: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + offsetMin(tz, d) * 60_000).toISOString().slice(0, 16);
}

/** Tomorrow and the day after at 10:00 shop time, for the first visit. */
export function defaultPeriod(tz: string, now = new Date()) {
  const day = (n: number) => isoToShopTime(new Date(now.getTime() + n * 86_400_000).toISOString(), tz).slice(0, 10);
  return { from: `${day(1)}T10:00`, to: `${day(2)}T10:00` };
}
