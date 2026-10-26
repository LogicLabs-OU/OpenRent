#!/usr/bin/env node
// Scaffolds an OpenRent child theme (FR-THM-9): `npx create-openrent-theme my-theme [--extends default]`.
// A child theme is data on top of an installed theme: colours, texts, home layout, CSS and images.
// Shops upload it in Admin → Themes; no build is needed. `openrent theme pack` makes the ZIP.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Theme API the template is written for. */
const API = '1.4.0';

export function files({ id, name, parent }) {
  return {
    'theme.json': JSON.stringify({ id, name, version: '0.1.0', author: 'You', license: 'MIT', compat: `^${API}`, extends: parent, locales: ['en'] }, null, 2) + '\n',
    'config/settings_data.json': JSON.stringify({ accent: '#7c3aed', radius: 'lg' }, null, 2) + '\n',
    'locales/en.json': JSON.stringify({ 'nav.all': 'Everything to rent' }, null, 2) + '\n',
    'theme.css': `/* Loaded after ${parent}'s styles. Files in assets/ can be used with url(assets/<name>). */
body {
  background-image: url(assets/grain.svg);
}
`,
    'assets/grain.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence baseFrequency=".9"/></filter><rect width="120" height="120" filter="url(#n)" opacity=".03"/></svg>
`,
    'README.md': `# ${name}

A child theme of **${parent}** for OpenRent.

- \`config/settings_data.json\`: default settings (the parent's settings_schema.json lists them).
- \`locales/<language>.json\`: texts that replace the parent's.
- \`config/sections_data.json\` (optional): the default home page layout.
- \`theme.css\` and \`assets/\`: extra styles, images and fonts.

\`openrent theme check\` checks it; \`openrent theme pack\` makes \`${id}-<version>.zip\` for Admin → Themes → Upload theme.
`,
  };
}

export async function scaffold(dir, opts = {}) {
  const id = opts.id ?? path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9-]+$/.test(id) || !id) throw new Error(`"${id}" is not a valid theme id: use lowercase letters, digits and dashes`);
  if (existsSync(path.join(dir, 'theme.json'))) throw new Error(`${dir} already has a theme`);
  const parent = opts.parent ?? 'default';
  const name = opts.name ?? id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  for (const [rel, content] of Object.entries(files({ id, name, parent }))) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  }
  return { id, name, parent };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : undefined);
  const dir = args.find((a, i) => !a.startsWith('--') && !['--name', '--extends'].includes(args[i - 1]));
  if (!dir) {
    process.stderr.write('Usage: create-openrent-theme <folder> [--extends default] [--name "Theme name"]\n');
    process.exit(1);
  }
  try {
    const r = await scaffold(dir, { name: opt('--name'), parent: opt('--extends') });
    process.stdout.write(`Created ${r.name} (${r.id}), based on ${r.parent}, in ${dir}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
