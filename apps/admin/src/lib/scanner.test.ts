import { describe, expect, it } from 'vitest';
import { cleanScan, detectScanner, DEFAULT_SCANNER } from './scanner.ts';

const typed = (text: string, end: string | null, gap = 8) => [...[...text].map((key, i) => ({ key, at: i * gap })), ...(end ? [{ key: end, at: text.length * gap }] : [])];

describe('scanner setup', () => {
  it('learns a prefix, a suffix and the ending key from one scan', () => {
    const c = detectScanner(typed(']C1OR-12345#', 'Tab', 12), 'OR-12345');
    expect(c).toEqual({ prefix: ']C1', suffix: '#', terminator: 'Tab', maxGapMs: 50, minLength: 4 });
    expect(cleanScan(']C1OR-777#', c)).toBe('OR-777');
  });

  it('handles scanners that send no ending key and slow ones', () => {
    const c = detectScanner(typed('ABC', null, 40), 'ABC');
    expect(c).toMatchObject({ prefix: '', suffix: '', terminator: 'none', maxGapMs: 80, minLength: 3 });
    expect(detectScanner(typed('X1', 'Enter', 400), '').maxGapMs).toBe(150);
  });

  it('keeps the code when the printed text is not in the scan', () => {
    expect(detectScanner(typed('12345678', 'Enter'), 'nope')).toMatchObject({ prefix: '', suffix: '', terminator: 'Enter' });
    expect(cleanScan('12345678', DEFAULT_SCANNER)).toBe('12345678');
  });
});
