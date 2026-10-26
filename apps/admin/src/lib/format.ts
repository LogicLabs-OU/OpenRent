import { session } from './session.svelte.ts';
import { getLocale } from './i18n/index.svelte.ts';

export function dt(v: string | Date | null | undefined, tz = session.tz, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!v) return '—';
  const s = new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: tz }).format(new Date(v));
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (viewerTz !== tz && opts.timeStyle) {
    const abbr = new Intl.DateTimeFormat(getLocale(), { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(v)).find((p) => p.type === 'timeZoneName')?.value;
    return `${s} ${abbr ?? ''}`.trim();
  }
  return s;
}

export const d = (v: string | Date | null | undefined, tz?: string) => dt(v, tz, { dateStyle: 'medium' });

/** Relative time shown next to an absolute one (PRD §4.1). */
export function rel(v: string | Date) {
  const diff = new Date(v).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86400_000), 'day');
}

/** `<input type="datetime-local">` value in a time zone ↔ ISO instant. */
export function toLocalInput(iso: string | Date, tz = session.tz): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function fromLocalInput(v: string, tz = session.tz): string {
  const [date, time] = v.split('T');
  const [y, m, dd] = date!.split('-').map(Number);
  const [h, mi] = (time ?? '00:00').split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, dd!, h!, mi!);
  const off = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - t;
  };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t).toISOString();
}

export function minorFromInput(v: string | number): number {
  return Math.round(Number(String(v).replace(',', '.')) * 100);
}

export const majorFromMinor = (n: number | null | undefined) => ((n ?? 0) / 100).toFixed(2);
