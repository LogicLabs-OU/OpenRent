import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { CHILD_THEME_FILE, OPTIONAL_TEMPLATES, REQUIRED_TEMPLATES, checkThemeSource, validateThemeMeta } from '@openrent/theme-sdk/manifest';
import { readTheme } from '@openrent/api/themes';

/**
 * `openrent theme check | pack | install` (FR-THM-9). Child themes (theme.json with "extends") are data
 * that shops upload in the admin; code themes are installed here by the operator and need a rebuild.
 */
export interface ThemeCheck {
  id: string | null;
  version: string | null;
  kind: 'child' | 'code' | null;
  errors: string[];
  warnings: string[];
}

const SKIP = new Set(['node_modules', '.git', '.DS_Store', '.svelte-kit', 'dist']);

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    if (SKIP.has(name) || name.endsWith('.zip')) continue;
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

export async function checkTheme(dir: string): Promise<ThemeCheck> {
  if (!existsSync(path.join(dir, 'theme.json'))) return { id: null, version: null, kind: null, errors: ['theme.json is missing'], warnings: [] };
  let manifest: any;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, 'theme.json'), 'utf8'));
  } catch (err) {
    return { id: null, version: null, kind: null, errors: [`theme.json is not valid JSON: ${(err as Error).message}`], warnings: [] };
  }
  const files = await walk(dir);
  const errors: string[] = [];
  const warnings: string[] = [];
  const kind = manifest.extends ? 'child' : 'code';
  if (kind === 'child') {
    for (const f of files) if (!CHILD_THEME_FILE.test(f)) errors.push(`${f}: a child theme may contain only theme.json, theme.css, config/settings_data.json, config/sections_data.json, locales/*.json and assets/`);
    for (const k of ['id', 'name', 'version', 'author', 'license', 'compat']) if (!manifest[k]) errors.push(`theme.json: missing "${k}"`);
  } else {
    errors.push(...validateThemeMeta(readTheme(dir, dir)));
    for (const name of REQUIRED_TEMPLATES) if (!files.includes(`templates/${name}.svelte`)) errors.push(`missing template templates/${name}.svelte`);
    if (!files.includes('layouts/theme.svelte')) errors.push('missing layouts/theme.svelte');
    for (const name of OPTIONAL_TEMPLATES) if (!files.includes(`templates/${name}.svelte`)) warnings.push(`templates/${name}.svelte is not there; the default theme's is used`);
    if (!files.includes('index.ts') && !files.includes('index.js')) errors.push('missing index.ts (the theme module)');
    for (const f of files.filter((x) => /\.(svelte|ts|js)$/.test(x))) errors.push(...checkThemeSource(f, await readFile(path.join(dir, f), 'utf8')));
  }
  // Every language should have the same texts as English.
  const locales = files.filter((f) => /^locales\/[a-z]{2}\.json$/.test(f));
  const en = locales.includes('locales/en.json') ? Object.keys(JSON.parse(await readFile(path.join(dir, 'locales/en.json'), 'utf8'))).filter((k) => k !== '_meta') : [];
  for (const f of locales) {
    if (f === 'locales/en.json') continue;
    const cat = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    const missing = en.filter((k) => !(k in cat));
    if (missing.length) warnings.push(`${f} is missing ${missing.length} text(s): ${missing.slice(0, 5).join(', ')}`);
  }
  return { id: manifest.id ?? null, version: manifest.version ?? null, kind, errors, warnings };
}

export async function packTheme(dir: string, out?: string) {
  const check = await checkTheme(dir);
  if (check.errors.length) return { ...check, file: null };
  const entries: Record<string, Uint8Array> = {};
  for (const rel of await walk(dir)) entries[rel] = new Uint8Array(await readFile(path.join(dir, rel)));
  const file = out ?? path.join(dir, `${check.id}-${check.version}.zip`);
  await writeFile(file, zipSync(entries, { level: 9 }));
  return { ...check, file };
}

/** Unpacks a code theme into THEMES_DIR/<id>; the storefront includes it at its next build. */
export async function installTheme(zipFile: string, themesDir: string) {
  const entries = unzipSync(new Uint8Array(await readFile(zipFile)));
  const names = Object.keys(entries).filter((n) => !n.endsWith('/'));
  const roots = new Set(names.map((n) => n.split('/')[0]));
  const strip = roots.size === 1 && names.every((n) => n.includes('/')) ? `${[...roots][0]}/` : '';
  const files = names.map((n) => [n.slice(strip.length), entries[n]!] as const);
  if (files.some(([rel]) => !rel || rel.startsWith('/') || rel.split('/').includes('..'))) throw new Error('the package contains an unsafe path');
  const manifestEntry = files.find(([rel]) => rel === 'theme.json');
  if (!manifestEntry) throw new Error('theme.json is missing');
  const manifest = JSON.parse(strFromU8(manifestEntry[1]));
  if (manifest.extends) throw new Error('this is a child theme: shops upload it in Admin → Themes');
  if (!/^[a-z0-9-]+$/.test(manifest.id ?? '')) throw new Error('theme.json: id must be lowercase letters, digits and dashes');
  const target = path.join(themesDir, manifest.id);
  await rm(target, { recursive: true, force: true });
  for (const [rel, data] of files) {
    await mkdir(path.dirname(path.join(target, rel)), { recursive: true });
    await writeFile(path.join(target, rel), data);
  }
  const check = await checkTheme(target);
  if (check.errors.length) {
    await rm(target, { recursive: true, force: true });
    return { ...check, dir: null };
  }
  return { ...check, dir: target };
}
