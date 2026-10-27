#!/usr/bin/env node
/* global process, console */
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { scaffold } from './scaffold.js';

/** npm create openrent-storefront [dir] [--api URL] [--key pk_…] [--shop slug] */
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const opts = { apiUrl: flag('api'), publishableKey: flag('key'), tenantSlug: flag('shop') };
let dir = args[0];

if (process.stdin.isTTY && (!dir || !opts.apiUrl || (!opts.publishableKey && !opts.tenantSlug))) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  dir ||= (await rl.question('Folder for the new shop (my-rental-shop): ')).trim() || 'my-rental-shop';
  opts.apiUrl ||= (await rl.question('OpenRent address (http://localhost:7070): ')).trim() || 'http://localhost:7070';
  if (!opts.publishableKey && !opts.tenantSlug) {
    const answer = (await rl.question('Publishable key (pk_…) or shop slug: ')).trim();
    if (answer.startsWith('pk_')) opts.publishableKey = answer;
    else opts.tenantSlug = answer;
  }
  rl.close();
}
if (!dir) {
  console.error('Usage: create-openrent-storefront <folder> --api <url> (--key <pk_…> | --shop <slug>)');
  process.exit(1);
}

try {
  const { dir: made } = await scaffold({ dir, ...opts });
  const rel = path.relative(process.cwd(), made) || '.';
  console.log(`\nYour shop is in ${rel}. Next:\n\n  cd ${rel}\n  npm install\n  npm run dev\n`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
