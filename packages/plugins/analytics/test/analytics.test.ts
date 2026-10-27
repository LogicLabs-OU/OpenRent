import { describe, expect, it } from 'vitest';
import plugin, { SCRIPTS } from '../src/index.ts';

describe('analytics plugin', () => {
  it('needs plugin API 1.7 and loads each tool only when its id is set', () => {
    expect(plugin.compat).toBe('^1.7.0');
    expect(SCRIPTS.map((s) => [s.requires, s.consent])).toEqual([['ga4_id', 'analytics'], ['meta_pixel_id', 'marketing'], ['plausible_domain', 'analytics']]);
    for (const s of SCRIPTS) expect(Object.keys(s.attrs ?? {}).every((k) => k.startsWith('data-'))).toBe(true);
  });
});
