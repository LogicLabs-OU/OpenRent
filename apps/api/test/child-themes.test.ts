import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
// @ts-expect-error plain JS bin without types
import { scaffold } from '../../../packages/create-openrent-theme/bin/create.mjs';
import { packTheme } from '../../../packages/cli/src/theme-kit.ts';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

suite('child themes', () => {
  let t: TestApp;
  let admin: Client;
  let dir: string;
  const settings = () => t.app.inject({ method: 'GET', url: '/api/v1/storefront/settings' }).then((r) => r.json());

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    dir = path.join(await mkdtemp(path.join(tmpdir(), 'child-')), 'harbour');
    await scaffold(dir, { parent: 'default' });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('installs a child theme after showing what it adds', async () => {
    const { file } = await packTheme(dir);
    const staged = await admin.upload('/api/v1/themes/install', 'harbour.zip', 'application/zip', await readFile(file!));
    expect(staged.status).toBe(200);
    expect(staged.body).toMatchObject({ theme: { id: 'harbour', version: '0.1.0', extends: 'default' }, update: null, diff: { changed: [], removed: [], removed_settings: [] } });
    expect(staged.body.diff.added).toEqual(['README.md', 'assets/grain.svg', 'config/settings_data.json', 'locales/en.json', 'theme.css', 'theme.json']);
    expect((await admin.get('/api/v1/themes')).body.data.some((x: any) => x.id === 'harbour')).toBe(false);

    expect((await admin.post(`/api/v1/themes/install/${staged.body.id}/actions/confirm`)).body).toMatchObject({ status: 'installed', theme: { id: 'harbour' } });
    const list = (await admin.get('/api/v1/themes')).body.data;
    expect(list.find((x: any) => x.id === 'harbour')).toMatchObject({ extends: 'default', status: 'ok', live: false });
    const detail = await admin.get('/api/v1/themes/harbour');
    expect(detail.status).toBe(200);

    expect((await admin.post('/api/v1/themes/harbour/actions/publish')).status).toBe(200);
    const theme = (await settings()).theme;
    expect(theme).toMatchObject({ id: 'harbour', code_id: 'default', settings: { accent: '#7c3aed' } });
    expect(theme.translations.en['nav.all']).toBe('Everything to rent');
    const url: string = theme.assets['grain.svg'];
    expect(theme.css).toContain(url);
    const asset = await t.app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toBe('image/svg+xml');
    expect(asset.headers['cache-control']).toContain('immutable');
  });

  it('shows the changes of an update and drops replaced files', async () => {
    const oldUrl: string = (await settings()).theme.assets['grain.svg'];
    await writeFile(path.join(dir, 'theme.css'), 'body { color: #111; }\n');
    await rm(path.join(dir, 'assets', 'grain.svg'));
    await writeFile(path.join(dir, 'theme.json'), (await readFile(path.join(dir, 'theme.json'), 'utf8')).replace('0.1.0', '0.2.0'));
    await rm(path.join(dir, 'harbour-0.1.0.zip'));
    const { file } = await packTheme(dir);
    const staged = await admin.upload('/api/v1/themes/install', 'harbour.zip', 'application/zip', await readFile(file!));
    expect(staged.body).toMatchObject({ update: { from_version: '0.1.0' }, diff: { added: [], changed: ['theme.css', 'theme.json'], removed: ['assets/grain.svg'] } });
    await admin.post(`/api/v1/themes/install/${staged.body.id}/actions/confirm`);
    const theme = (await settings()).theme;
    expect(theme.css).toContain('#111');
    expect(theme.assets).toEqual({});
    expect((await t.app.inject({ method: 'GET', url: new URL(oldUrl).pathname })).statusCode).toBe(404);
  });

  it('refuses code themes and packages it does not understand, and keeps the live theme', async () => {
    const code = zipSync({ 'theme.json': strToU8(JSON.stringify({ id: 'shiny', name: 'Shiny', version: '1.0.0', author: 'x', license: 'MIT', compat: '^1.4.0' })), 'templates/index.svelte': strToU8('<p>hi</p>') });
    const r = await admin.upload('/api/v1/themes/install', 'shiny.zip', 'application/zip', Buffer.from(code));
    expect(r.status).toBe(422);
    expect(r.body.errors[0]).toMatchObject({ field: 'file' });
    expect(r.body.detail).toContain('openrent theme install');
    const orphan = zipSync({ 'theme.json': strToU8(JSON.stringify({ id: 'lost', name: 'Lost', version: '1.0.0', author: 'x', license: 'MIT', compat: '^1.4.0', extends: 'nowhere' })) });
    expect((await admin.upload('/api/v1/themes/install', 'lost.zip', 'application/zip', Buffer.from(orphan))).body.detail).toContain('nowhere');
    expect((await admin.upload('/api/v1/themes/install', 'x.zip', 'application/zip', Buffer.from('nope'))).status).toBe(422);

    expect((await admin.del('/api/v1/themes/harbour')).status).toBe(409);
    await admin.post('/api/v1/themes/default/actions/publish');
    expect((await admin.del('/api/v1/themes/harbour')).status).toBe(204);
    expect((await settings()).theme).toMatchObject({ id: 'default', code_id: 'default' });
  });
});
