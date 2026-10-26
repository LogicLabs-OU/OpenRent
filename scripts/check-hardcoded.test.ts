import { describe, expect, it } from 'vitest';
import { findHardcoded, isLanguage } from './check-hardcoded.ts';

describe('hard-coded text check', () => {
  it('flags words in markup and text attributes', () => {
    const hits = findHardcoded(`<script>let x = 'Not markup';</script>\n<p>Save order</p>\n<input placeholder="Search here" />`);
    expect(hits).toEqual(['2: Save order', '3: placeholder="Search here"']);
  });
  it('accepts translated text, codes, brands and ignored elements', () => {
    const src = `<p>{t('a')}</p><title>{t('b')} · OpenRent</title><input placeholder="sk_test_…" /><input placeholder="EE" />\n<!-- i18n-ignore --><input placeholder="update" />`;
    expect(findHardcoded(src)).toEqual([]);
  });
  it('tells language from codes', () => {
    expect(isLanguage('* or order.*')).toBe(true);
    expect(isLanguage('https://example.com/hook')).toBe(false);
    expect(isLanguage('Stripe')).toBe(false);
  });
});
