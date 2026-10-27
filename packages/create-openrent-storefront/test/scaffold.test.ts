import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scaffold } from '../scaffold.js';

const root = await mkdtemp(path.join(tmpdir(), 'openrent-starter-'));
afterAll(() => rm(root, { recursive: true, force: true }));

describe('create-openrent-storefront', () => {
  it('copies the starter, names it after its folder and writes .env', async () => {
    const dir = path.join(root, 'Bike Hire');
    await scaffold({ dir, apiUrl: 'https://rent.example.com/', publishableKey: 'pk_test_abc123' });
    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(['.gitignore', '.env', '.env.example', 'README.md', 'package.json', 'src', 'vite.config.ts']));
    expect(files).not.toContain('_gitignore');
    expect(files).not.toContain('node_modules');
    expect(files.filter((f) => f.startsWith('.svelte-kit'))).toEqual([]);
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('bike-hire');
    expect(pkg.dependencies['@openrent/sdk']).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(await readFile(path.join(dir, '.env'), 'utf8')).toBe('OPENRENT_API_URL=https://rent.example.com\nOPENRENT_PUBLISHABLE_KEY=pk_test_abc123\nOPENRENT_TENANT_SLUG=\n');
    expect((await stat(path.join(dir, '.env'))).mode & 0o777).toBe(0o600);
    expect(await readdir(path.join(dir, 'src/routes'))).toEqual(expect.arrayContaining(['cart', 'checkout', 'order', 'p', '+layout.svelte', '+page.svelte']));
  });

  it('refuses a folder in use, a secret key and an odd address', async () => {
    const used = path.join(root, 'used');
    await scaffold({ dir: used, tenantSlug: 'demo' });
    await expect(scaffold({ dir: used, tenantSlug: 'demo' })).rejects.toThrow('is not empty');
    await expect(scaffold({ dir: path.join(root, 'secret'), publishableKey: 'sk_live_abc' })).rejects.toThrow('publishable key');
    await expect(scaffold({ dir: path.join(root, 'odd'), apiUrl: 'javascript:alert(1)' })).rejects.toThrow('http');
  });
});
