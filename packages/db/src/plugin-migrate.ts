import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { INVARIANTS_FILE } from './migrate.ts';

/**
 * Plugin migrations (FR-PLG-9). A static check accepts only statements on the plugin's own `plg_<id>_`
 * tables and indexes; every new table must carry `tenant_id`, so the invariants give it row-level
 * security like OpenRent's own tables. Anything else (functions, triggers, roles, other tables) is refused.
 */
export const pluginPrefix = (pluginId: string) => `plg_${pluginId.replace(/-/g, '_')}_`;

const FORBIDDEN = /\b(function|procedure|trigger|policy|grant|revoke|owner|role|extension|security|set_config|schema|rule|copy|do)\b|\$\$/i;

/** Statements of a migration with comments removed; quoted names are compared without quotes. */
function statements(sql: string) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((s) => s.trim().replace(/"/g, ''))
    .filter(Boolean);
}

export function checkPluginSql(pluginId: string, sql: string): string[] {
  const own = pluginPrefix(pluginId);
  const name = `(?:public\\.)?(${own}[a-z0-9_]+)`;
  const shapes = [
    new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${name}\\s*\\(`, 'i'),
    new RegExp(`^create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?${own}[a-z0-9_]+\\s+on\\s+${name}\\b`, 'i'),
    new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${name}\\s`, 'i'),
    new RegExp(`^drop\\s+(?:table|index)\\s+(?:if\\s+exists\\s+)?${name}(\\s|$)`, 'i'),
    new RegExp(`^insert\\s+into\\s+${name}[\\s(]`, 'i'),
    new RegExp(`^comment\\s+on\\s+(?:table|column)\\s+${name}\\b`, 'i'),
  ];
  const errors: string[] = [];
  statements(sql).forEach((st, i) => {
    const head = st.slice(0, 80).replace(/\s+/g, ' ');
    if (FORBIDDEN.test(st)) errors.push(`statement ${i + 1} (${head}…) uses a command plugins may not run`);
    else if (!shapes.some((re) => re.test(st))) errors.push(`statement ${i + 1} (${head}…) does not work on a ${own} table`);
    else if (/^create\s+table/i.test(st) && !/\btenant_id\s+text\s+not\s+null\b/i.test(st)) errors.push(`statement ${i + 1}: the table needs "tenant_id text NOT NULL"`);
  });
  return errors;
}

export interface PluginMigrationSet {
  pluginId: string;
  migrations: { name: string; sql: string }[];
}

/** Applies plugins' pending migrations in name order, then re-applies the invariants (RLS, grants). */
export async function migratePlugins(connectionString: string, sets: PluginMigrationSet[], log: (m: string) => void = () => undefined) {
  const applied: string[] = [];
  const refused: { pluginId: string; name: string; errors: string[] }[] = [];
  if (!sets.some((s) => s.migrations.length)) return { applied, refused };
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [7_340_212]);
    for (const set of sets) {
      const done = new Map((await client.query<{ name: string; checksum: string }>(`SELECT name, checksum FROM plugin_migrations WHERE plugin_id = $1`, [set.pluginId])).rows.map((r) => [r.name, r.checksum]));
      for (const m of [...set.migrations].sort((a, b) => a.name.localeCompare(b.name))) {
        const checksum = createHash('sha256').update(m.sql).digest('hex');
        if (done.has(m.name)) {
          if (done.get(m.name) !== checksum) log(`plugin ${set.pluginId}: migration ${m.name} changed after it was applied; it is not run again`);
          continue;
        }
        const errors = checkPluginSql(set.pluginId, m.sql);
        if (errors.length) {
          refused.push({ pluginId: set.pluginId, name: m.name, errors });
          log(`plugin ${set.pluginId}: migration ${m.name} refused: ${errors.join('; ')}`);
          // Later migrations of this plugin build on this one.
          break;
        }
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query(`INSERT INTO plugin_migrations (plugin_id, name, checksum) VALUES ($1, $2, $3)`, [set.pluginId, m.name, checksum]);
          await client.query('COMMIT');
          applied.push(`${set.pluginId}/${m.name}`);
          log(`plugin ${set.pluginId}: applied ${m.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    }
    if (applied.length && existsSync(INVARIANTS_FILE)) await client.query(await readFile(INVARIANTS_FILE, 'utf8'));
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [7_340_212]).catch(() => undefined);
    await client.end();
  }
  return { applied, refused };
}
