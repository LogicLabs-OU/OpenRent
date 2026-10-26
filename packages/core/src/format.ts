/** Locale-aware formatting shared by documents and emails (Intl only). */
export function formatMoney(amount: number, currency: string, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.trim() }).format(amount / 100);
}

export function formatDate(d: Date | string, tz: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium' }).format(new Date(d));
}

export function formatDateTime(d: Date | string, tz: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
