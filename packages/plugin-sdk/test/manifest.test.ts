import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/index.ts';

const ok = { id: 'loyalty-points', name: 'Loyalty points', version: '1.2.0', compat: '^1.1.0' };

describe('plugin manifest', () => {
  it('accepts a complete manifest', () => {
    const r = validateManifest({
      ...ok,
      permissions: ['orders:read', 'db:own_tables'],
      settings: [{ key: 'api_key', label: 'API key', type: 'secret' }],
      locales: { en: { 'loyalty.title': 'Points' }, de: { 'loyalty.title': 'Punkte' } },
      admin: [{ slot: 'customer.tab', file: 'admin/points.js' }],
      jobs: [{ name: 'expire', cron: '0 3 * * *' }],
      migrations: 'migrations',
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.manifest).toMatchObject({ id: 'loyalty-points', migrationsDir: 'migrations', jobs: [{ name: 'expire' }] });
  });

  it('refuses what cannot load and warns about the rest', () => {
    const r = validateManifest({ id: 'Bad Id', name: '', version: '1', compat: '', admin: [{ slot: 'nowhere', file: 'x.js' }], jobs: [{ name: 'x', cron: 'daily' }], migrations: '../up' });
    expect(r.manifest).toBeNull();
    expect(r.errors).toHaveLength(7);
    const w = validateManifest({ ...ok, cron: '* * * * *', colour: 'red', permissions: ['root'] });
    expect(w.manifest).not.toBeNull();
    expect(w.warnings).toEqual(['"cron" is deprecated: use "jobs": [{ "name": …, "cron": … }] and api.schedule()', 'unknown key "colour" is ignored', 'unknown permission "root"']);
    expect(validateManifest([]).errors).toEqual(['the manifest must be a JSON object']);
  });
});
