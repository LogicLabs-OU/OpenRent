import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPlugin, packPlugin } from '../../cli/src/plugin-kit.ts';
// @ts-expect-error plain JS bin without types
import { scaffold } from '../bin/create.mjs';

describe('create-openrent-plugin', () => {
  it('makes a plugin that passes the checks and packs', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'orp-')), 'gate-codes');
    expect(await scaffold(dir)).toEqual({ id: 'gate-codes', name: 'Gate codes' });
    const check = await checkPlugin(dir);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
    const packed = await packPlugin(dir);
    expect(packed.file).toMatch(/gate-codes-0\.1\.0\.zip$/);
    await expect(scaffold(dir)).rejects.toThrow(/already has a plugin/);
    await expect(scaffold(path.join(dir, '..', 'other'), { id: '1-starts-with-a-digit' })).rejects.toThrow(/not a valid plugin id/);
  });
});
