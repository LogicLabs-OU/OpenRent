import { formatLocale } from './locale.svelte.js';

export { setFormatLocale } from './locale.svelte.js';

export interface MoneyValue {
  amount: number;
  currency: string;
}

/** Money in `locale`, else the app's language (`setFormatLocale`), else `<html lang>`, so amounts match the text. */
export function formatMoney(m: MoneyValue | null | undefined, locale?: string): string {
  if (!m) return '—';
  const lang = locale ?? formatLocale() ?? (typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined);
  return new Intl.NumberFormat(lang, { style: 'currency', currency: m.currency }).format(m.amount / 100);
}

/** Status palette (PRD §4.1): colour always comes with a text label. */
export type StatusTone = 'neutral' | 'info' | 'violet' | 'success' | 'warning' | 'danger' | 'muted';

const TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  quote: 'info',
  reserved: 'info',
  prepared: 'violet',
  out: 'success',
  paid: 'success',
  available: 'success',
  succeeded: 'success',
  held: 'success',
  sent: 'success',
  delivered: 'success',
  enabled: 'success',
  public: 'success',
  returned_partial: 'warning',
  partially_paid: 'warning',
  partially_captured: 'warning',
  needs_inspection: 'warning',
  soft_down: 'warning',
  pending: 'warning',
  queued: 'warning',
  open: 'warning',
  overdue: 'danger',
  unpaid: 'danger',
  failed: 'danger',
  bounced: 'danger',
  hard_down: 'danger',
  lost: 'danger',
  damaged: 'danger',
  blocked: 'danger',
  disabled_failures: 'danger',
  planned: 'info',
  in_transit: 'violet',
  received: 'success',
};

export function statusTone(status: string): StatusTone {
  return TONES[status] ?? 'muted';
}

export const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-border bg-secondary text-secondary-foreground',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  muted: 'border-border bg-muted text-muted-foreground',
};

export function humanize(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
