import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { CHILD_THEME_FILE, validateThemeMeta, type SectionInstance, type ThemeManifest } from '@openrent/theme-sdk/manifest';
import type { Ctx } from '../context.ts';
import { AppError, invalid, notFound } from '../errors.ts';
import { audit } from '../events.ts';
import { newId } from '../ids.ts';
import { t } from '../i18n/index.ts';
import { exec, json, many, one } from '../sql.ts';
import { deleteFile, getFile, putFile, readFile } from '../files/index.ts';
import { cleanCss } from '../storefront/code.ts';
import { resolveSettings } from '../tenancy/settings.ts';
import type { InstalledTheme } from './index.ts';

/**
 * Child themes (FR-THM-8): a ZIP with theme.json (`extends`: an installed code theme), theme.css,
 * config/settings_data.json, config/sections_data.json, locales/*.json and assets/. The shop installs it
 * at runtime; the parent's code renders it. Updates show what changes before the owner confirms.
 */
const MAX_ZIP = 15 * 1024 * 1024;
const MAX_ASSET = 3 * 1024 * 1024;
const MAX_CSS = 200 * 1024;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', css: 'text/css',
};

const refuse = (message: string) => invalid(message, [{ field: 'file', code: 'invalid', message }]);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

interface ChildRow {
  id: string;
  theme_id: string;
  parent_id: string;
  version: string;
  manifest: ThemeManifest;
  settings_data: Record<string, unknown>;
  sections_data: SectionInstance[] | null;
  locales: Record<string, Record<string, string>>;
  css: string;
  assets: Record<string, string>;
  file_hashes: Record<string, string>;
}

/** Public URL of a child theme's asset (served by GET /public/theme_assets). */
export const themeAssetUrl = (ctx: Ctx, fileId: string, path: string) => `${ctx.config.publicUrl.replace(/\/$/, '')}/api/v1/public/theme_assets/${fileId}/${encodeURIComponent(path.split('/').pop()!)}`;

/** A child theme as the theme screens see it: the parent's schema with the child's defaults, texts and layout. */
function asInstalled(row: ChildRow, parent: InstalledTheme | undefined): InstalledTheme {
  const locales: Record<string, Record<string, string>> = { ...(parent?.locales ?? {}) };
  for (const [l, cat] of Object.entries(row.locales)) locales[l] = { ...(locales[l] ?? {}), ...cat };
  const meta = {
    manifest: { ...row.manifest, sections: parent?.manifest.sections },
    settingsSchema: parent?.settingsSchema ?? [],
    settingsData: { ...(parent?.settingsData ?? {}), ...row.settings_data },
    locales,
    sectionSchemas: parent?.sectionSchemas ?? [],
    sectionsData: row.sections_data ?? parent?.sectionsData,
  };
  const problems = parent ? (parent.problems.length ? [t('themes.parent_problems', { parent: row.parent_id })] : validateThemeMeta(meta)) : [t('themes.parent_missing', { parent: row.parent_id })];
  return { ...meta, package: `child:${row.theme_id}`, problems, parent: row.parent_id, css: row.css, assets: row.assets };
}

export async function childThemes(ctx: Ctx, installed: InstalledTheme[]): Promise<InstalledTheme[]> {
  const rows = await many<ChildRow>(ctx, `SELECT * FROM custom_themes ORDER BY created_at`);
  return rows.map((r) => asInstalled(r, installed.find((x) => x.manifest.id === r.parent_id && !x.parent)));
}

/** Code themes of the installation plus this shop's child themes. */
export async function availableThemes(ctx: Ctx, installed: InstalledTheme[]) {
  return [...installed, ...(await childThemes(ctx, installed))];
}

interface Package {
  manifest: ThemeManifest;
  css: string;
  settingsData: Record<string, unknown>;
  sectionsData: SectionInstance[] | null;
  locales: Record<string, Record<string, string>>;
  assets: Map<string, Uint8Array>;
  hashes: Record<string, string>;
}

function readPackage(zip: Buffer, installed: InstalledTheme[]): Package {
  if (zip.length > MAX_ZIP) throw refuse(t('themes.package.too_large', { mb: MAX_ZIP / 1024 / 1024 }));
  let entries: Record<string, Uint8Array>;
  // Limits on what the package unpacks to, so a small ZIP cannot fill the server's memory.
  let unpacked = 0;
  let count = 0;
  let tooBig = false;
  try {
    entries = unzipSync(new Uint8Array(zip), {
      filter: (f) => {
        unpacked += f.originalSize;
        if (++count > 500 || unpacked > 40 * 1024 * 1024) {
          tooBig = true;
          throw new Error('too large');
        }
        return !f.name.endsWith('/') && f.originalSize <= MAX_ASSET * 2;
      },
    });
  } catch {
    throw refuse(tooBig ? t('themes.package.too_large', { mb: 40 }) : t('themes.package.not_a_zip'));
  }
  // A single top folder (a zipped theme folder) is accepted as well as files at the root.
  const names = Object.keys(entries);
  const roots = new Set(names.map((n) => n.split('/')[0]));
  const strip = roots.size === 1 && names.every((n) => n.includes('/')) ? `${[...roots][0]}/` : '';
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    const rel = name.slice(strip.length);
    if (/\.(svelte|ts|js|mjs)$/.test(rel) || rel === 'package.json') throw refuse(t('themes.package.code_theme'));
    if (!CHILD_THEME_FILE.test(rel) || rel.split('/').includes('..')) throw refuse(t('themes.package.bad_file', { file: rel }));
    files.set(rel, data);
  }
  const text = (f: string) => (files.has(f) ? strFromU8(files.get(f)!) : null);
  const parse = <T>(f: string, fallback: T): T => {
    const raw = text(f);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw refuse(t('themes.package.bad_json', { file: f }));
    }
  };
  const manifest = parse<ThemeManifest | null>('theme.json', null);
  if (!manifest) throw refuse(t('themes.package.no_manifest'));
  if (!manifest.extends) throw refuse(t('themes.package.code_theme'));
  const parent = installed.find((x) => x.manifest.id === manifest.extends && !x.parent);
  if (!parent) throw refuse(t('themes.parent_missing', { parent: manifest.extends }));
  if (installed.some((x) => x.manifest.id === manifest.id && !x.parent)) throw refuse(t('themes.package.id_taken', { id: manifest.id }));
  const css = text('theme.css') ?? '';
  if (css.length > MAX_CSS) throw refuse(t('themes.package.css_too_large'));
  const assets = new Map<string, Uint8Array>();
  for (const [f, data] of files) {
    if (!f.startsWith('assets/')) continue;
    if (data.length > MAX_ASSET) throw refuse(t('themes.package.asset_too_large', { file: f, mb: MAX_ASSET / 1024 / 1024 }));
    assets.set(f.slice('assets/'.length), data);
  }
  const locales: Record<string, Record<string, string>> = {};
  for (const [f] of files) {
    const m = /^locales\/([a-z]{2})\.json$/.exec(f);
    if (m) locales[m[1]!] = parse(f, {});
  }
  return {
    manifest,
    css,
    settingsData: parse('config/settings_data.json', {}),
    sectionsData: parse<SectionInstance[] | null>('config/sections_data.json', null),
    locales,
    assets,
    hashes: Object.fromEntries([...files].map(([f, d]) => [f, sha(d)])),
  };
}

/** Checks a child theme package and keeps it until the owner confirms; returns what would change. */
export async function stageThemePackage(ctx: Ctx, installed: InstalledTheme[], zip: Buffer) {
  const pkg = readPackage(zip, installed);
  const parent = installed.find((x) => x.manifest.id === pkg.manifest.extends)!;
  const preview = asInstalled(
    { id: '', theme_id: pkg.manifest.id, parent_id: parent.manifest.id, version: pkg.manifest.version, manifest: pkg.manifest, settings_data: pkg.settingsData, sections_data: pkg.sectionsData, locales: pkg.locales, css: pkg.css, assets: {}, file_hashes: pkg.hashes },
    parent,
  );
  if (preview.problems.length) throw refuse(t('themes.package.invalid', { problems: preview.problems.join('; ') }));
  const old = await one<ChildRow>(ctx, `SELECT * FROM custom_themes WHERE theme_id = $1`, [pkg.manifest.id]);
  const before = old?.file_hashes ?? {};
  const s = resolveSettings((await one<{ settings: unknown }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId]))?.settings);
  const known = new Set(preview.settingsSchema.flatMap((g) => g.settings.map((x) => x.id)));
  const file = await putFile(ctx, { kind: 'theme_package', filename: `${pkg.manifest.id}-${pkg.manifest.version}.zip`, contentType: 'application/zip', body: zip });
  return {
    object: 'theme_install',
    id: file.id,
    theme: { id: pkg.manifest.id, name: pkg.manifest.name, version: pkg.manifest.version, extends: parent.manifest.id, author: pkg.manifest.author ?? null },
    update: old ? { from_version: old.version } : null,
    diff: {
      added: Object.keys(pkg.hashes).filter((f) => !(f in before)).sort(),
      changed: Object.keys(pkg.hashes).filter((f) => f in before && before[f] !== pkg.hashes[f]).sort(),
      removed: Object.keys(before).filter((f) => !(f in pkg.hashes)).sort(),
      // Saved values the theme no longer has a setting for are dropped on publish.
      removed_settings: Object.keys(s.theme_settings[pkg.manifest.id] ?? {}).filter((k) => !known.has(k)).sort(),
    },
  };
}

/** Installs (or updates) the staged package. Assets become public files; the CSS points at them. */
export async function confirmThemePackage(ctx: Ctx, installed: InstalledTheme[], stagedFileId: string) {
  const staged = await getFile(ctx, stagedFileId).catch(() => null);
  if (!staged || staged.kind !== 'theme_package') throw new AppError('not_found', 404, t('themes.package.expired'));
  const pkg = readPackage(await readFile(ctx, staged), installed);
  const old = await one<ChildRow>(ctx, `SELECT * FROM custom_themes WHERE theme_id = $1`, [pkg.manifest.id]);
  const assets: Record<string, string> = {};
  for (const [p, data] of pkg.assets) {
    const ext = p.split('.').pop()!.toLowerCase();
    const f = await putFile(ctx, { kind: 'theme_asset', ownerType: 'custom_theme', ownerId: pkg.manifest.id, filename: p.split('/').pop()!, contentType: MIME[ext] ?? 'application/octet-stream', body: Buffer.from(data) });
    assets[p] = f.id;
  }
  const css = cleanCss(pkg.css.replace(/url\(\s*(['"]?)(?:\.\/)?assets\/([^'")]+)\1\s*\)/g, (m, _q, p: string) => (assets[p] ? `url("${themeAssetUrl(ctx, assets[p]!, p)}")` : m)));
  const values = [pkg.manifest.extends, pkg.manifest.version, json(pkg.manifest), json(pkg.settingsData), pkg.sectionsData ? json(pkg.sectionsData) : null, json(pkg.locales), css, json(assets), json(pkg.hashes)];
  if (old) await exec(ctx, `UPDATE custom_themes SET parent_id = $2, version = $3, manifest = $4, settings_data = $5, sections_data = $6, locales = $7, css = $8, assets = $9, file_hashes = $10 WHERE id = $1`, [old.id, ...values]);
  else await exec(ctx, `INSERT INTO custom_themes (id, tenant_id, theme_id, parent_id, version, manifest, settings_data, sections_data, locales, css, assets, file_hashes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [newId('cth'), ctx.tenantId, pkg.manifest.id, ...values]);
  for (const fileId of Object.values(old?.assets ?? {})) await deleteFile(ctx, fileId).catch(() => undefined);
  await deleteFile(ctx, staged.id);
  await audit(ctx, { entity_type: 'theme', entity_id: pkg.manifest.id, action: old ? 'update' : 'install', extra: { version: pkg.manifest.version, from_version: old?.version ?? null } });
  return { object: 'theme_install', theme: { id: pkg.manifest.id, name: pkg.manifest.name, version: pkg.manifest.version }, status: 'installed' };
}

export async function removeChildTheme(ctx: Ctx, id: string) {
  const row = await one<ChildRow>(ctx, `SELECT * FROM custom_themes WHERE theme_id = $1`, [id]);
  if (!row) throw notFound('theme', id);
  const s = resolveSettings((await one<{ settings: unknown }>(ctx, `SELECT settings FROM tenants WHERE id = $1`, [ctx.tenantId]))?.settings);
  if (s.theme.id === id) throw new AppError('theme_live', 409, t('themes.remove_live'));
  await exec(ctx, `DELETE FROM custom_themes WHERE id = $1`, [row.id]);
  for (const fileId of Object.values(row.assets)) await deleteFile(ctx, fileId).catch(() => undefined);
  await audit(ctx, { entity_type: 'theme', entity_id: id, action: 'delete' });
  return { id, object: 'theme', deleted: true };
}

/** What the storefront needs of a child theme: the parent's code, plus CSS, texts and asset URLs. */
export async function childThemeFor(ctx: Ctx, id: string) {
  const row = await one<ChildRow>(ctx, `SELECT * FROM custom_themes WHERE theme_id = $1`, [id]);
  if (!row) return null;
  return {
    parent: row.parent_id,
    css: row.css,
    settingsData: row.settings_data,
    sectionsData: row.sections_data,
    locales: row.locales,
    assets: Object.fromEntries(Object.entries(row.assets).map(([p, fileId]) => [p, themeAssetUrl(ctx, fileId, p)])),
  };
}
