import { describe, expect, it } from 'vitest';
import { format, lookup, messageShape, pickLocale, pseudoLocalize, weekStart, hourCycle, formatTime } from '../src/index.ts';

describe('pickLocale', () => {
  it('follows quality values and maps regional variants', () => {
    expect(pickLocale('de-AT,de;q=0.9,en;q=0.5', ['en', 'de'])).toBe('de');
    expect(pickLocale('fr-CA;q=0.4, ja;q=0.8', ['en', 'fr', 'ja'])).toBe('ja');
    expect(pickLocale('nl,en;q=0.7', ['en', 'et'])).toBe('en');
  });
  it('returns null when nothing fits or the header is missing', () => {
    expect(pickLocale('nl,pt', ['en', 'de'])).toBeNull();
    expect(pickLocale(undefined, ['en'])).toBeNull();
    expect(pickLocale('de;q=0', ['de'])).toBeNull();
  });
});

describe('format', () => {
  const msg = '{count, plural, =0 {nothing} one {# item} other {# items}} in {place}';
  it('picks plural forms by the language rules', () => {
    expect(format(msg, { count: 0, place: 'cart' })).toBe('nothing in cart');
    expect(format(msg, { count: 1, place: 'cart' })).toBe('1 item in cart');
    expect(format(msg, { count: 5, place: 'cart' }, 'et')).toBe('5 items in cart');
    // Japanese has only "other".
    expect(format('{n, plural, other {#件}}', { n: 1 }, 'ja')).toBe('1件');
  });
  it('keeps unknown parameters visible', () => expect(format('Hi {name}')).toBe('Hi {name}'));
});

describe('lookup', () => {
  it('falls back to English key by key and hides metadata', () => {
    const cats = { en: { a: 'A', b: 'B', _meta: 'x' }, de: { a: 'Ä' } };
    expect(lookup(cats, 'a', 'de')).toBe('Ä');
    expect(lookup(cats, 'b', 'de')).toBe('B');
    expect(lookup(cats, '_meta', 'en')).toBeUndefined();
  });
});

describe('nested messages', () => {
  const msg = '{count, plural, =0 {{name} is not available} one {Only # {name} is available} other {Only # {name} are available}}';
  it('fills placeholders inside plural forms', () => {
    expect(format(msg, { count: 0, name: 'Kayak' })).toBe('Kayak is not available');
    expect(format(msg, { count: 1, name: 'Kayak' })).toBe('Only 1 Kayak is available');
    expect(format(msg, { count: 3, name: 'Kayak' })).toBe('Only 3 Kayak are available');
  });
  it('reports the shape of nested messages', () => {
    const s = messageShape(msg);
    expect([...s.params]).toEqual(['name']);
    expect([...s.plurals]).toEqual(['count']);
    expect([...messageShape('{n, plural, one {x}}').plurals]).toContain('n:missing-other');
  });
});

describe('pseudoLocalize', () => {
  it('marks text but keeps placeholders and plurals working', () => {
    const p = pseudoLocalize('{count, plural, one {# order for {name}} other {# orders for {name}}}');
    expect(format(p, { count: 2, name: 'Mari' })).toMatch(/^⟦2 ördérs för Mari·+⟧$/);
    expect(pseudoLocalize('Save')).toBe('⟦Sávé··⟧');
  });
});

describe('calendar conventions', () => {
  it('knows the first day of the week', () => {
    expect(weekStart('en-US')).toBe(0);
    expect(weekStart('de')).toBe(1);
    expect(weekStart('et')).toBe(1);
    expect(weekStart('ja')).toBe(0);
  });
  it('knows 12- and 24-hour clocks', () => {
    expect(hourCycle('en-US')).toBe('h12');
    expect(hourCycle('de')).toBe('h23');
    expect(formatTime('14:30', 'de')).toBe('14:30');
    expect(formatTime('14:30', 'en-US')).toMatch(/^2:30\sPM$/);
  });
});
