import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { AppError, serverT } from '@openrent/core';
import { checkPluginSql } from '@openrent/db';
import { validateManifest } from '@openrent/plugin-sdk';
import type { AppDeps } from './deps.ts';
import { DEFAULT_PLUGINS_JSON } from './plugins.ts';

/**
 * Installing a plugin from the admin (FR-PLG-2). The ZIP is unpacked into a staging folder and checked
 * (manifest, entry file, migrations); the owner sees what the plugin asks for, then confirms. The plugin
 * is copied into PLUGINS_DIR and listed in plugins.json; it loads at the next restart. Installing means
 * trusting the code: plugins run inside OpenRent's process.
 */
const MAX_ZIP = 20 * 1024 * 1024;
const MAX_UNPACKED = 60 * 1024 * 1024;
const MAX_FILES = 2000;
const STAGING = path.join(os.tmpdir(), 'openrent-plugin-staging');

const refuse = (key: Parameters<typeof serverT>[0], params: Record<string, string | number> = {}) =>
  new AppError('plugin_package_invalid', 422, serverT(key, params), { errors: [{ field: 'file', code: 'invalid', message: serverT(key, params) }] });

/** Fetches a ZIP from an https URL, at most MAX_ZIP bytes. */
export async function downloadZip(url: string): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AppError('validation_error', 422, serverT('plugins.install.bad_url'), { errors: [{ field: 'url', code: 'invalid', message: serverT('plugins.install.bad_url') }] });
  }
  if (u.protocol !== 'https:') throw new AppError('validation_error', 422, serverT('plugins.install.bad_url'), { errors: [{ field: 'url', code: 'invalid', message: serverT('plugins.install.bad_url') }] });
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !res.body) throw new AppError('download_failed', 502, serverT('plugins.install.download_failed', { status: res.status }));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_ZIP) throw refuse('plugins.install.too_large', { mb: MAX_ZIP / 1024 / 1024 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Unpacks and checks a plugin package; returns what the owner confirms. */
export async function stagePlugin(deps: AppDeps, zip: Buffer) {
  if (zip.length > MAX_ZIP) throw refuse('plugins.install.too_large', { mb: MAX_ZIP / 1024 / 1024 });
  let entries: Record<string, Uint8Array>;
  let unpacked = 0;
  let count = 0;
  try {
    entries = unzipSync(new Uint8Array(zip), {
      filter: (f) => {
        unpacked += f.originalSize;
        count++;
        if (unpacked > MAX_UNPACKED || count > MAX_FILES) throw new Error('too large');
        return !f.name.endsWith('/');
      },
    });
  } catch {
    throw refuse('plugins.install.not_a_zip');
  }
  // Packages made by `openrent plugin pack` have files at the root; a single top folder is accepted too.
  const names = Object.keys(entries);
  const roots = new Set(names.map((n) => n.split('/')[0]));
  const strip = roots.size === 1 && names.every((n) => n.includes('/')) ? `${[...roots][0]}/` : '';
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    const rel = name.slice(strip.length);
    if (!rel || rel.startsWith('/') || rel.split('/').some((p) => p === '..' || p === '') || rel.includes('\\')) throw refuse('plugins.install.bad_path', { path: name });
    files.set(rel, data);
  }
  const text = (f: string) => (files.has(f) ? Buffer.from(files.get(f)!).toString('utf8') : null);
  const manifestText = text('openrent.plugin.json');
  if (!manifestText || !text('package.json')) throw refuse('plugins.install.missing_files');
  let check: ReturnType<typeof validateManifest>;
  let pkg: { main?: string };
  try {
    check = validateManifest(JSON.parse(manifestText));
    pkg = JSON.parse(text('package.json')!);
  } catch {
    throw refuse('plugins.install.bad_manifest', { errors: 'JSON' });
  }
  if (!check.manifest) throw refuse('plugins.install.bad_manifest', { errors: check.errors.join('; ') });
  const m = check.manifest;
  if (!files.has(pkg.main ?? 'index.js')) throw refuse('plugins.install.no_entry', { file: pkg.main ?? 'index.js' });
  for (const a of m.admin ?? []) if (!files.has(a.file)) throw refuse('plugins.install.no_entry', { file: a.file });
  if (m.migrationsDir) {
    for (const [f, data] of files) {
      if (!f.startsWith(`${m.migrationsDir.replace(/\/$/, '')}/`) || !f.endsWith('.sql')) continue;
      const errors = checkPluginSql(m.id, Buffer.from(data).toString('utf8'));
      if (errors.length) throw refuse('plugins.install.bad_migration', { file: f, errors: errors.join('; ') });
    }
  }
  const id = `${m.id}-${Date.now().toString(36)}`;
  const dir = path.join(STAGING, id);
  for (const [rel, data] of files) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), data);
  }
  const installed = deps.plugins.statuses.find((s) => s.id === m.id);
  return {
    object: 'plugin_install',
    id,
    plugin: { id: m.id, name: m.name, version: m.version, compat: m.compat, author: m.author ?? null, permissions: m.permissions ?? [], settings: (m.settings ?? []).map((s) => s.key), admin: (m.admin ?? []).map((a) => a.slot), jobs: m.jobs ?? [] },
    warnings: check.warnings,
    replaces: installed ? { version: installed.version } : null,
  };
}

/** Moves a staged plugin into PLUGINS_DIR and lists it in plugins.json. */
export async function confirmInstall(deps: AppDeps, stagingId: string) {
  if (!/^[a-z][a-z0-9-]{1,39}-[a-z0-9]+$/.test(stagingId)) throw new AppError('not_found', 404, serverT('plugins.install.expired'));
  const dir = path.join(STAGING, stagingId);
  if (!existsSync(path.join(dir, 'openrent.plugin.json'))) throw new AppError('not_found', 404, serverT('plugins.install.expired'));
  const m = validateManifest(JSON.parse(await readFile(path.join(dir, 'openrent.plugin.json'), 'utf8'))).manifest!;
  const target = path.join(deps.config.pluginsDir, m.id);
  await mkdir(deps.config.pluginsDir, { recursive: true });
  if (existsSync(target)) await rm(target, { recursive: true, force: true });
  await cp(dir, target, { recursive: true });
  await rm(dir, { recursive: true, force: true });
  const configPath = deps.config.pluginsConfig ?? DEFAULT_PLUGINS_JSON;
  const config = existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf8')) : { plugins: [] };
  const listed = (config.plugins as (string | { package: string })[]).some((e) => (typeof e === 'string' ? e : e.package) === m.id);
  if (!listed) {
    config.plugins.push(m.id);
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  }
  return { object: 'plugin_install', id: stagingId, plugin: { id: m.id, name: m.name, version: m.version }, status: 'installed', restart_required: true };
}
