#!/usr/bin/env node
// Scaffolds an OpenRent plugin (FR-PLG-9): `npx create-openrent-plugin my-plugin [--name "My plugin"]`.
// The result passes `openrent plugin check` and packs with `openrent plugin pack`.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Plugin API the template is written for; the SDK checks `compat` against the running OpenRent. */
const API = '1.1.0';

export function files({ id, name }) {
  const prefix = `plg_${id.replace(/-/g, '_')}_`;
  const element = `${id}-order-sidebar`;
  return {
    'package.json': JSON.stringify({ name: `openrent-plugin-${id}`, version: '0.1.0', private: true, type: 'module', main: 'index.js', scripts: { test: 'vitest run', check: 'openrent plugin check', pack: 'openrent plugin pack' } }, null, 2) + '\n',
    'openrent.plugin.json': JSON.stringify(
      {
        id,
        name,
        version: '0.1.0',
        compat: `^${API}`,
        permissions: ['orders:read', 'db:own_tables', 'admin:ui'],
        settings: [{ key: 'greeting', label: 'Greeting on the order page', type: 'text' }],
        admin: [{ slot: 'order.sidebar', file: 'admin/order-sidebar.js', element }],
        jobs: [{ name: 'tidy', cron: '0 3 * * *' }],
        migrations: 'migrations',
        locales: { en: { [`${id}.title`]: name } },
      },
      null,
      2,
    ) + '\n',
    'index.js': `// @ts-check
/** @typedef {import('@openrent/plugin-sdk').PluginDefinition} PluginDefinition */
import manifest from './openrent.plugin.json' with { type: 'json' };

/** @type {PluginDefinition} */
export default {
  ...manifest,
  migrations: undefined,
  setup(api) {
    // Count every order this plugin sees, in the plugin's own table.
    api.after('orders.transition', async (payload, ctx) => {
      if (payload.to !== 'reserved') return;
      await ctx.scope.db.query(
        'INSERT INTO ${prefix}seen (tenant_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [ctx.tenantId, payload.order_id],
      );
    });

    // GET /api/v1/plugins/${id}/seen
    api.route({
      method: 'GET',
      path: '/seen',
      permission: 'orders:read',
      async handler(_req, ctx) {
        const r = await ctx.scope.db.query('SELECT count(*)::int AS n FROM ${prefix}seen');
        return { object: 'count', count: r.rows[0].n };
      },
    });

    // Nightly: forget orders older than a year.
    api.schedule('tidy', '0 3 * * *', async (ctx) => {
      await ctx.scope.db.query("DELETE FROM ${prefix}seen WHERE created_at < now() - interval '1 year'");
    });
  },
};
`,
    'migrations/0001_init.sql': `-- Tables a plugin creates must start with ${prefix} and have tenant_id (each shop sees only its rows).
CREATE TABLE ${prefix}seen (
  tenant_id text NOT NULL,
  order_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id)
);
`,
    'admin/order-sidebar.js': `// The admin places <${element}> in the order sidebar and sets \`context\` = { order_id }.
class OrderSidebar extends HTMLElement {
  set context(ctx) {
    this.textContent = \`${name}: \${ctx.order_id}\`;
  }
}
customElements.define('${element}', OrderSidebar);
`,
    'test/plugin.test.js': `import { afterAll, beforeAll, expect, it } from 'vitest';
import { startTestShop } from '@openrent/plugin-testing';
import plugin from '../index.js';

let shop;
beforeAll(async () => {
  shop = await startTestShop({ plugins: [{ ...plugin, migrations: [{ name: '0001_init', sql: (await import('node:fs')).readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8') }] }] });
}, 120_000);
afterAll(() => shop?.close());

it('answers on its route', async () => {
  const r = await shop.get('/api/v1/plugins/${id}/seen');
  expect(r.body).toEqual({ object: 'count', count: 0 });
});
`,
    'README.md': `# ${name}

An OpenRent plugin.

- \`openrent plugin check\` checks the manifest, entry file and migrations.
- \`openrent plugin pack\` makes \`${id}-<version>.zip\` for Admin → Plugins → Install plugin.
- Tests run against a throwaway shop: \`npm test\`.

Plugins run inside OpenRent with access to the shop's data: write only to your \`${prefix}\` tables.
`,
  };
}

export async function scaffold(dir, opts = {}) {
  const id = opts.id ?? path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw new Error(`"${id}" is not a valid plugin id: use 2–40 lowercase letters, digits or dashes`);
  if (existsSync(path.join(dir, 'openrent.plugin.json'))) throw new Error(`${dir} already has a plugin`);
  const name = opts.name ?? id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  for (const [rel, content] of Object.entries(files({ id, name }))) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  }
  return { id, name };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const nameAt = args.indexOf('--name');
  if (!dir) {
    process.stderr.write('Usage: create-openrent-plugin <folder> [--name "Plugin name"]\n');
    process.exit(1);
  }
  try {
    const r = await scaffold(dir, { name: nameAt >= 0 ? args[nameAt + 1] : undefined });
    process.stdout.write(`Created ${r.name} (${r.id}) in ${dir}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
