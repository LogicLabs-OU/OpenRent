import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTheme, packTheme } from '../../cli/src/theme-kit.ts';
// @ts-expect-error plain JS bin without types
import { scaffold } from '../bin/create.mjs';

describe('create-openrent-theme', () => {
  it('makes a child theme that passes the checks and packs', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'ort-')), 'harbour');
    expect(await scaffold(dir, { parent: 'retro' })).toEqual({ id: 'harbour', name: 'Harbour', parent: 'retro' });
    expect(await checkTheme(dir)).toMatchObject({ id: 'harbour', kind: 'child', errors: [], warnings: [] });
    expect((await packTheme(dir)).file).toMatch(/harbour-0\.1\.0\.zip$/);
    await expect(scaffold(dir)).rejects.toThrow(/already has a theme/);
  });
});
