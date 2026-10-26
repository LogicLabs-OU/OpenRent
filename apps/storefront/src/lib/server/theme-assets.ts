import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sources, themes } from 'virtual:openrent-themes';
import defaultTheme from '@openrent/theme-default';

/**
 * Files in code themes' `assets/` folders (FR-THM-1), served at /themes/{id}/assets/{name}.{hash}.{ext}.
 * The content hash is in the name, so browsers keep them for a year; a changed file gets a new URL.
 */
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', css: 'text/css; charset=utf-8', json: 'application/json',
};

interface Asset {
  file: string;
  type: string;
}

const urls = new Map<string, Record<string, string>>();
const files = new Map<string, Asset>();

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

function themeDir(source: (typeof sources)[number]) {
  if ('dir' in source) return source.dir;
  try {
    return path.dirname(createRequire(import.meta.url).resolve(`${source.pkg}/package.json`));
  } catch {
    return null;
  }
}

function index() {
  const list = [{ pkg: '@openrent/theme-default' }, ...sources];
  const ids = [defaultTheme.manifest.id, ...themes.map((t) => t.manifest.id)];
  list.forEach((src, i) => {
    const id = ids[i]!;
    const dir = themeDir(src);
    const assets = dir && path.join(dir, 'assets');
    const map: Record<string, string> = {};
    if (assets && existsSync(assets)) {
      for (const rel of walk(assets)) {
        const ext = rel.split('.').pop()!.toLowerCase();
        if (!TYPES[ext]) continue;
        const file = path.join(assets, rel);
        const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
        const hashed = rel.replace(/(\.[^./]+)$/, `.${hash}$1`);
        map[rel] = `/themes/${id}/assets/${hashed}`;
        files.set(`${id}/${hashed}`, { file, type: TYPES[ext]! });
      }
    }
    urls.set(id, map);
  });
}

let indexed = false;
const ensure = () => {
  if (!indexed) {
    index();
    indexed = true;
  }
};

/** Path in assets/ → hashed URL, for one code theme. */
export function themeAssets(themeId: string): Record<string, string> {
  ensure();
  return urls.get(themeId) ?? {};
}

export function themeAssetFile(themeId: string, hashedPath: string): Asset | null {
  ensure();
  return files.get(`${themeId}/${hashedPath}`) ?? null;
}
