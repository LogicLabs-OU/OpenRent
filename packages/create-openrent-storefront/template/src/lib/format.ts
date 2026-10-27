import type { Money } from '@openrent/sdk/storefront';

/** Money and times as the shop shows them: its currency, and times in its time zone. */
export function formatter(lang: string, timezone: string) {
  const money = new Map<string, Intl.NumberFormat>();
  const when = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
  return {
    money: (m: Money | null | undefined) => {
      if (!m) return '';
      if (!money.has(m.currency)) money.set(m.currency, new Intl.NumberFormat(lang, { style: 'currency', currency: m.currency }));
      return money.get(m.currency)!.format(m.amount / 100);
    },
    when: (iso: string | null | undefined) => (iso ? when.format(new Date(iso)) : ''),
  };
}
