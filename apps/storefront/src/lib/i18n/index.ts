import { BASE_LOCALE, format, lookup as find, type Catalog, type Locale } from '@openrent/i18n';
import en from './en.json';
import de from './de.json';
import fr from './fr.json';
import es from './es.json';
import et from './et.json';
import ja from './ja.json';

export type MessageKey = keyof typeof en;

const catalogs = { en, de, fr, es, et, ja } as unknown as Record<Locale, Catalog>;

/** Storefront strings outside the theme (errors, payment form). Falls back to English. */
export function t(key: MessageKey, params: Record<string, string | number> = {}, locale: string = BASE_LOCALE): string {
  return format(find(catalogs, key, locale) ?? key, params, locale);
}

/** Untyped lookup used by the theme runtime as a fallback for keys a theme does not define. */
export function lookup(key: string, locale: string = BASE_LOCALE): string | undefined {
  return find(catalogs, key, locale);
}
