import { AsyncLocalStorage } from 'node:async_hooks';
import { BASE_LOCALE, format, isLocale, lookup, type Catalog, type Locale } from '@openrent/i18n';
import en from './en.json' with { type: 'json' };
import de from './de.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };
import et from './et.json' with { type: 'json' };
import ja from './ja.json' with { type: 'json' };

export type MessageKey = keyof typeof en;

const catalogs = { en, de, fr, es, et, ja } as unknown as Record<Locale, Catalog>;

/** The language of the current request (API sets it from the staff user or Accept-Language). */
const current = new AsyncLocalStorage<Locale>();

/** Runs `fn` with server messages in `locale`. */
export function withLocale<T>(locale: string | null | undefined, fn: () => T): T {
  return current.run(isLocale(locale) ? locale : BASE_LOCALE, fn);
}

/** Sets the language for the rest of the current async context (a request hook). */
export function enterLocale(locale: string | null | undefined) {
  current.enterWith(isLocale(locale) ? locale : BASE_LOCALE);
}

export function currentLocale(): Locale {
  return current.getStore() ?? BASE_LOCALE;
}

/** A shop's own wording (FR-I18N-6) for one language, while an email or document of that shop renders. */
const shopStrings = new AsyncLocalStorage<{ locale: string; strings: Record<string, string> }>();

/** Runs `fn` with the shop's overrides of server texts in `locale` (email and document rendering). */
export function withStrings<T>(locale: string, strings: Record<string, string>, fn: () => T): T {
  return shopStrings.run({ locale, strings }, fn);
}

function text(key: string, l: string) {
  const own = shopStrings.getStore();
  if (own && own.locale === l && key in own.strings) return own.strings[key];
  return lookup(catalogs, key, l);
}

/** Server messages (errors, emails, documents). Missing translations fall back to English. */
export function t(key: MessageKey, params: Record<string, string | number> = {}, locale?: string): string {
  const l = locale && isLocale(locale) ? locale : currentLocale();
  return format(text(key, l) ?? key, params, l);
}

/** Untyped lookup for template helpers (`{{t "email.total"}}`); unknown keys render as the key. */
export function tAny(key: string, params: Record<string, string | number> = {}, locale?: string): string {
  const l = locale && isLocale(locale) ? locale : currentLocale();
  return format(text(key, l) ?? key, params, l);
}

/** The built-in server texts, for the string override editor. */
export function serverCatalogs(): Record<Locale, Catalog> {
  return catalogs;
}
