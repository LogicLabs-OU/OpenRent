import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * `virtual:openrent-themes` (FR-THM-3): the code themes this storefront is built with — the packages in
 * themes.json plus every theme folder in THEMES_DIR (`openrent theme install` puts operator-installed
 * themes there). Adding a code theme means a rebuild; child themes need none (they are data).
 */
export function openrentThemes(opts: { themesConfig: string; themesDir?: string }): Plugin {
  const ID = 'virtual:openrent-themes';
  const read = () => {
    const packages: string[] = existsSync(opts.themesConfig) ? (JSON.parse(readFileSync(opts.themesConfig, 'utf8')).themes ?? []) : ['@openrent/theme-default'];
    const dirs = opts.themesDir && existsSync(opts.themesDir)
      ? readdirSync(opts.themesDir)
          .map((d) => path.join(opts.themesDir!, d))
          .filter((d) => existsSync(path.join(d, 'theme.json')) && ['index.ts', 'index.js'].some((f) => existsSync(path.join(d, f))))
      : [];
    return [...packages.map((pkg) => ({ pkg, entry: pkg })), ...dirs.map((dir) => ({ dir, entry: path.join(dir, existsSync(path.join(dir, 'index.ts')) ? 'index.ts' : 'index.js') }))];
  };
  return {
    name: 'openrent-themes',
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return;
      const list = read();
      for (const f of [opts.themesConfig, opts.themesDir].filter(Boolean)) this.addWatchFile(f!);
      return [
        ...list.map((t, i) => `import t${i} from ${JSON.stringify(t.entry)};`),
        `export const themes = [${list.map((_, i) => `t${i}`).join(', ')}];`,
        // Where each theme's files are, so the server can serve their assets/ folder.
        `export const sources = ${JSON.stringify(list.map((t) => ('pkg' in t ? { pkg: t.pkg } : { dir: t.dir })))};`,
      ].join('\n');
    },
  };
}
