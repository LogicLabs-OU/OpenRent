import { BASE_LOCALE, LOCALES, format, isLocale, lookup, pickLocale, pseudoLocalize, type Catalog, type Locale } from '@openrent/i18n';
import { setFormatLocale } from '@openrent/ui/openrent';
import en from './en.json';

/**
 * Typed admin messages (PRD §3.18): keys are checked at compile time, ICU plurals work, and the
 * language can change at runtime. English ships in the bundle; other languages load when chosen.
 */
export type MessageKey = keyof typeof en;

const loaders = import.meta.glob<{ default: Catalog }>(['./*.json', '!./en.json']);
let locale = $state<Locale>(BASE_LOCALE);
let catalogs = $state.raw<Partial<Record<Locale, Catalog>>>({ en: en as Catalog });
/** Development only: `?locale=en-XA` shows the pseudo-translation, so text outside the catalogue stands out. */
let pseudo = $state(false);

export function getLocale(): Locale {
  return locale;
}

/** The browser's preferred supported language (before sign-in), else English. */
export function browserLocale(): Locale {
  return (typeof navigator !== 'undefined' && pickLocale(navigator.languages?.join(',') ?? navigator.language, LOCALES)) || BASE_LOCALE;
}

/** In development, the language forced by `?locale=` (including the `en-XA` pseudo-locale). */
export function devLocale(): string | null {
  return import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('locale') : null;
}

/** Switches the admin language, loading its catalogue first. Unknown codes fall back to English. */
export async function setLocale(l: string | null | undefined) {
  pseudo = import.meta.env.DEV && l === 'en-XA';
  const next = isLocale(l) ? l : BASE_LOCALE;
  if (!catalogs[next]) {
    const mod = await loaders[`./${next}.json`]?.();
    if (mod) catalogs = { ...catalogs, [next]: mod.default };
  }
  locale = next;
  setFormatLocale(next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const msg = lookup(catalogs, key, locale) ?? key;
  return format(pseudo ? pseudoLocalize(msg) : msg, params, locale);
}
