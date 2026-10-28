import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { current, render } from './compat-matrix.ts';

describe('compatibility matrix', () => {
  it('is current with the SDKs', () => {
    const history = JSON.parse(readFileSync(new URL('../docs/compatibility.json', import.meta.url), 'utf8'));
    expect(readFileSync(new URL('../docs/compatibility.md', import.meta.url), 'utf8')).toBe(render(history));
  });

  it('lists releases newest first and marks long-term support', () => {
    const page = render({ releases: { '1.9.0': { plugin_api: '1.9.0', theme_api: '1.10.0' }, '1.10.0': { plugin_api: '1.10.0', theme_api: '1.10.0', lts_until: '2028-05-01' } } }, current());
    const rows = page.split('\n').filter((l) => /^\| \d/.test(l));
    expect(rows).toEqual(['| 1.10.0 (LTS) | 1.10.0 | 1.10.0 | Security fixes until 2028-05-01 |', '| 1.9.0 | 1.9.0 | 1.10.0 |  |']);
  });
});
