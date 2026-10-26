import { BASE_LOCALE, format, isLocale, lookup, type Catalog, type Locale } from '@openrent/i18n';
import en from './en.json';
import de from './de.json';
import fr from './fr.json';
import es from './es.json';
import et from './et.json';
import ja from './ja.json';

export type MessageKey = keyof typeof en;

const catalogs = { en, de, fr, es, et, ja } as unknown as Record<Locale, Catalog>;

/**
 * The widget's language: its `lang` attribute, else the host page's `<html lang>`, else English.
 * Regional tags (`de-AT`) use their language.
 */
export function widgetLocale(attr?: string | null): Locale {
  for (const tag of [attr, typeof document !== 'undefined' ? document.documentElement.lang : null]) {
    const l = tag?.toLowerCase().split('-')[0];
    if (isLocale(l)) return l;
  }
  return BASE_LOCALE;
}

export function t(key: MessageKey, params: Record<string, string | number> = {}, locale: string = BASE_LOCALE): string {
  return format(lookup(catalogs, key, locale) ?? key, params, locale);
}
