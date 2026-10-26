/**
 * Languages OpenRent ships in, and the one message formatter every app uses. English is the base:
 * every catalogue falls back to it, key by key.
 */
export const LOCALES = ['en', 'de', 'fr', 'es', 'et', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const BASE_LOCALE: Locale = 'en';

/** Each language in its own words, for language menus. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', et: 'Eesti', ja: '日本語' };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * The best of `allowed` for an Accept-Language header (`de-AT,de;q=0.9,en;q=0.5`), matching
 * regional variants to their language. Null when none fits.
 */
export function pickLocale(header: string | null | undefined, allowed: readonly string[]): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...rest] = part.trim().split(';');
      const q = Number(rest.find((r) => r.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { lang: (tag ?? '').trim().toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { lang } of ranked) if (isLocale(lang) && allowed.includes(lang)) return lang;
  return null;
}

export type Params = Record<string, string | number>;
export type Catalog = Record<string, string>;

/** Index of the `}` that closes the `{` at `open`, or -1. */
function closing(msg: string, open: number): number {
  let depth = 0;
  for (let i = open; i < msg.length; i++) {
    if (msg[i] === '{') depth++;
    else if (msg[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** The forms of a plural body (`=0 {…} one {…} other {…}`); form texts may hold placeholders. */
function pluralForms(body: string): Record<string, string> {
  const forms: Record<string, string> = {};
  let i = 0;
  for (;;) {
    const m = /\s*(=\d+|\w+)\s*\{/y;
    m.lastIndex = i;
    const hit = m.exec(body);
    if (!hit) return forms;
    const open = m.lastIndex - 1;
    const close = closing(body, open);
    if (close < 0) return forms;
    forms[hit[1]!] = body.slice(open + 1, close);
    i = close + 1;
  }
}

/** Splits a message into text, `{name}` placeholders and `{name, plural, …}` blocks. */
function parts(msg: string): ({ text: string } | { param: string } | { plural: string; forms: Record<string, string> })[] {
  const out: ({ text: string } | { param: string } | { plural: string; forms: Record<string, string> })[] = [];
  let i = 0;
  while (i < msg.length) {
    const open = msg.indexOf('{', i);
    const close = open < 0 ? -1 : closing(msg, open);
    if (close < 0) {
      out.push({ text: msg.slice(i) });
      break;
    }
    if (open > i) out.push({ text: msg.slice(i, open) });
    const inner = msg.slice(open + 1, close);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (plural) out.push({ plural: plural[1]!, forms: pluralForms(plural[2]!) });
    else if (/^\s*\w+\s*$/.test(inner)) out.push({ param: inner.trim() });
    else out.push({ text: msg.slice(open, close + 1) });
    i = close + 1;
  }
  return out;
}

/**
 * Fills a message: ICU plurals (`{count, plural, one {# item} other {# items}}`, with `=N` exact
 * matches) chosen by the language's plural rules, and `{name}` parameters, also inside plural forms.
 */
export function format(msg: string, params: Params = {}, locale: string = BASE_LOCALE): string {
  return parts(msg)
    .map((p) => {
      if ('text' in p) return p.text;
      if ('param' in p) return params[p.param] !== undefined ? String(params[p.param]) : `{${p.param}}`;
      const n = Number(params[p.plural]);
      const form = p.forms[`=${n}`] ?? p.forms[new Intl.PluralRules(locale).select(n)] ?? p.forms.other ?? '';
      return format(form.replace(/#/g, String(n)), params, locale);
    })
    .join('');
}

const ACCENTS: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', y: 'ý', A: 'Å', E: 'É', I: 'Î', O: 'Ø', U: 'Ü', C: 'Ç', N: 'Ñ' };

/**
 * A pseudo-translation for testing (`en-XA`): accented letters, about 35 % longer, wrapped in ⟦…⟧,
 * so text that skips the catalogue or gets cut off stands out. Placeholders and plural syntax stay intact.
 */
export function pseudoLocalize(msg: string): string {
  const text = (t: string) => t.replace(/[a-zA-Z]/g, (c) => ACCENTS[c] ?? c);
  const body = (m: string): string =>
    parts(m)
      .map((p) => {
        if ('text' in p) return p.text.startsWith('{') ? p.text : text(p.text);
        if ('param' in p) return `{${p.param}}`;
        return `{${p.plural}, plural, ${Object.entries(p.forms).map(([k, f]) => `${k} {${body(f)}}`).join(' ')}}`;
      })
      .join('');
  const visible = parts(msg).reduce((n, p) => n + ('text' in p ? p.text.trim().length : 4), 0);
  return `⟦${body(msg)}${'·'.repeat(Math.ceil(visible * 0.35))}⟧`;
}

/** The placeholders and plural variables a message uses, for checking translations against English. */
export function messageShape(msg: string): { params: Set<string>; plurals: Set<string> } {
  const params = new Set<string>();
  const plurals = new Set<string>();
  for (const p of parts(msg)) {
    if ('param' in p) params.add(p.param);
    if ('plural' in p) {
      plurals.add(p.plural);
      if (!('other' in p.forms)) plurals.add(`${p.plural}:missing-other`);
      for (const f of Object.values(p.forms)) {
        const inner = messageShape(f);
        inner.params.forEach((x) => params.add(x));
        inner.plurals.forEach((x) => plurals.add(x));
      }
    }
  }
  return { params, plurals };
}

/** Looks a key up in the locale's catalogue, then in English. Keys starting with `_` are metadata. */
export function lookup(catalogs: Partial<Record<string, Catalog>>, key: string, locale: string): string | undefined {
  if (key.startsWith('_')) return undefined;
  return catalogs[locale]?.[key] ?? catalogs[BASE_LOCALE]?.[key];
}

/** Weekday codes for calendars: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const FIRST_DAY: Record<string, Weekday> = { en: 0, ja: 0, de: 1, fr: 1, es: 1, et: 1 };

/** First day of the week for a locale (Sunday in en/ja, Monday in de/fr/es/et, region tags respected where supported). */
export function weekStart(locale: string): Weekday {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = l.getWeekInfo?.() ?? l.weekInfo;
    if (info?.firstDay) return (info.firstDay % 7) as Weekday;
  } catch {
    // Unknown tag: fall through to the table.
  }
  return FIRST_DAY[locale.split('-')[0]!] ?? 1;
}

/** Whether a locale writes times with AM/PM (`h12`) or on a 24-hour clock (`h23`). */
export function hourCycle(locale: string): 'h12' | 'h23' {
  const hc = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return hc === 'h11' || hc === 'h12' ? 'h12' : 'h23';
}

/** A wall-clock `HH:MM` as the locale writes it ("2:30 PM", "14:30"). */
export function formatTime(hhmm: string, locale: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

/**
 * How a translation or a shop's own wording differs from the built-in text in its placeholders and
 * plural blocks; null when they match. Shared by `check-i18n` and the string override editor.
 */
export function shapeProblem(base: string, text: string): { params: string[]; plurals: boolean } | null {
  const a = messageShape(base);
  const b = messageShape(text);
  const same = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every((v) => y.has(v));
  const paramsOk = same(a.params, b.params);
  const pluralsOk = same(a.plurals, b.plurals);
  return paramsOk && pluralsOk ? null : { params: [...a.params], plurals: !pluralsOk };
}
