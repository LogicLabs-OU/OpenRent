import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Which plugin API and theme API each OpenRent release provides (docs/compatibility.md), from the SDKs'
 * constants. `--record` adds the release in package.json when cutting it (docs/guide/releasing.md); without
 * it the page is written again, and `--check` fails when it is out of date.
 */
const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const constant = (file: string, name: string) => {
  const m = new RegExp(`export const ${name} = '([\\d.]+)'`).exec(read(file));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return m[1]!;
};

export function current() {
  return {
    plugin_api: constant('packages/plugin-sdk/src/index.ts', 'PLUGIN_API_VERSION'),
    theme_api: constant('packages/theme-sdk/src/manifest.ts', 'THEME_API_VERSION'),
  };
}

export interface History {
  releases: Record<string, { plugin_api: string; theme_api: string; lts_until?: string }>;
}

const minor = (v: string) => v.split('.').slice(0, 2).join('.');

export function render(h: History, now = current()) {
  const rows = Object.entries(h.releases)
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
    .map(([v, r]) => `| ${v}${r.lts_until ? ' (LTS)' : ''} | ${r.plugin_api} | ${r.theme_api} | ${r.lts_until ? `Security fixes until ${r.lts_until}` : ''} |`);
  return `# Compatibility

Which plugin API and theme API each OpenRent release provides. Made by \`scripts/compat-matrix.ts\`; do not edit by hand.

A plugin's \`compat\` range and a theme's \`api\` range are checked against these. Minor versions only add things: a plugin for plugin API ${minor(now.plugin_api)} works with every later 1.x release, and a theme for theme API ${minor(now.theme_api)} likewise. Long-term support releases keep their API versions for their whole support time.

| OpenRent | Plugin API | Theme API | Support |
| --- | --- | --- | --- |
| next (main) | ${now.plugin_api} | ${now.theme_api} | |
${rows.join('\n')}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL('docs/compatibility.json', root);
  const h: History = JSON.parse(readFileSync(file, 'utf8'));
  if (process.argv.includes('--record')) {
    const version = JSON.parse(read('package.json')).version as string;
    const lts = process.argv.find((a) => a.startsWith('--lts-until='))?.split('=')[1];
    h.releases[version] = { ...current(), ...(lts ? { lts_until: lts } : {}) };
    writeFileSync(file, `${JSON.stringify(h, null, 2)}\n`);
  }
  const page = render(h);
  const out = new URL('docs/compatibility.md', root);
  if (process.argv.includes('--check')) {
    if (read('docs/compatibility.md') !== page) {
      console.error('docs/compatibility.md is out of date: run node scripts/compat-matrix.ts');
      process.exit(1);
    }
  } else writeFileSync(out, page);
}
