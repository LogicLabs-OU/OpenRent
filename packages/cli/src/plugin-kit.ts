import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { checkPluginSql } from '@openrent/db';
import { validateManifest, type ManifestCheck } from '@openrent/plugin-sdk';

/**
 * `openrent plugin check` and `openrent plugin pack` (FR-PLG-9): the checks the admin runs on upload,
 * run before publishing, and a ZIP the admin accepts.
 */
export interface PluginCheck {
  manifest: NonNullable<ManifestCheck['manifest']> | null;
  errors: string[];
  warnings: string[];
}

const SKIP = new Set(['node_modules', '.git', '.DS_Store', 'coverage']);

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    if (SKIP.has(name) || name.endsWith('.zip') || name.endsWith('.log')) continue;
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

export async function checkPlugin(dir: string): Promise<PluginCheck> {
  const manifestFile = path.join(dir, 'openrent.plugin.json');
  if (!existsSync(manifestFile)) return { manifest: null, errors: ['openrent.plugin.json is missing'], warnings: [] };
  let check: ManifestCheck;
  try {
    check = validateManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
  } catch (err) {
    return { manifest: null, errors: [`openrent.plugin.json is not valid JSON: ${(err as Error).message}`], warnings: [] };
  }
  const errors = [...check.errors];
  const warnings = [...check.warnings];
  const m = check.manifest;
  if (!existsSync(path.join(dir, 'package.json'))) errors.push('package.json is missing');
  else {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    if (!existsSync(path.join(dir, pkg.main ?? 'index.js'))) errors.push(`the entry file ${pkg.main ?? 'index.js'} is missing (build the plugin first?)`);
    if (pkg.type !== 'module') warnings.push('package.json should have "type": "module"');
  }
  if (m) {
    for (const a of m.admin ?? []) if (!existsSync(path.join(dir, a.file))) errors.push(`admin bundle ${a.file} is missing`);
    if (m.migrationsDir) {
      const mdir = path.join(dir, m.migrationsDir);
      if (!existsSync(mdir)) errors.push(`the migrations folder ${m.migrationsDir} is missing`);
      else
        for (const f of (await readdir(mdir)).filter((x) => x.endsWith('.sql')).sort()) {
          for (const e of checkPluginSql(m.id, await readFile(path.join(mdir, f), 'utf8'))) errors.push(`${m.migrationsDir}/${f}: ${e}`);
        }
    }
    // Every language should have the same texts as English.
    const en = Object.keys(m.locales?.en ?? {});
    for (const [lang, cat] of Object.entries(m.locales ?? {})) {
      if (lang === 'en') continue;
      const missing = en.filter((k) => !(k in cat));
      if (missing.length) warnings.push(`locales.${lang} is missing ${missing.length} text(s): ${missing.slice(0, 5).join(', ')}`);
    }
  }
  return { manifest: m, errors, warnings };
}

/** Checks, then zips the plugin folder (without node_modules) as <id>-<version>.zip. */
export async function packPlugin(dir: string, out?: string) {
  const check = await checkPlugin(dir);
  if (check.errors.length || !check.manifest) return { ...check, file: null };
  const entries: Record<string, Uint8Array> = {};
  for (const rel of await walk(dir)) entries[rel] = new Uint8Array(await readFile(path.join(dir, rel)));
  const file = out ?? path.join(dir, `${check.manifest.id}-${check.manifest.version}.zip`);
  await writeFile(file, zipSync(entries, { level: 9 }));
  return { ...check, file, files: Object.keys(entries).length };
}
