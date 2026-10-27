import { cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(here, 'template');
/** Generated or installed in the template folder while it is developed; never copied. */
const SKIP = new Set(['node_modules', '.svelte-kit', 'build', '.env']);

/** The SDK version the template was made with, for the new shop's package.json. */
async function sdkVersion() {
  try {
    return `^${JSON.parse(await readFile(path.join(here, '../sdk/package.json'), 'utf8')).version}`;
  } catch {
    return 'latest';
  }
}

const quote = (v) => (/^[\w.:/@+-]*$/.test(v) ? v : JSON.stringify(v));

/**
 * Copies the starter into `dir` (which must be empty or missing), names the package after the
 * folder and writes `.env` for the given installation and shop.
 */
export async function scaffold({ dir, apiUrl = 'http://localhost:7070', publishableKey = '', tenantSlug = '' }) {
  const target = path.resolve(dir);
  const existing = await readdir(target).catch(() => null);
  if (existing && existing.length) throw new Error(`${target} is not empty`);
  if (publishableKey && !/^pk_(live|test)_\w+$/.test(publishableKey)) throw new Error('The key must be a publishable key (pk_live_… or pk_test_…)');
  if (apiUrl && !/^https?:\/\/[^\s]+$/.test(apiUrl)) throw new Error('The API URL must start with http:// or https://');
  await mkdir(target, { recursive: true });
  await cp(TEMPLATE, target, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) && !path.basename(src).startsWith('.svelte-kit') });
  await rename(path.join(target, '_gitignore'), path.join(target, '.gitignore'));

  const pkgPath = path.join(target, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.name = path.basename(target).toLowerCase().replace(/[^a-z0-9-_.]+/g, '-').replace(/^[-_.]+/, '') || 'openrent-shop';
  pkg.dependencies['@openrent/sdk'] = await sdkVersion();
  delete pkg.private;
  pkg.private = true;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const env = [`OPENRENT_API_URL=${quote(apiUrl.replace(/\/$/, ''))}`, `OPENRENT_PUBLISHABLE_KEY=${quote(publishableKey)}`, `OPENRENT_TENANT_SLUG=${quote(tenantSlug)}`, ''].join('\n');
  await writeFile(path.join(target, '.env'), env, { mode: 0o600 });
  return { dir: target };
}
