/** Formats a local calendar date (YYYY-MM-DD) without shifting it through the browser's time zone. */
export function formatLocalDate(date: string, locale: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
