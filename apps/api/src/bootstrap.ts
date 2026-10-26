import { readFileSync } from 'node:fs';
import { createSecretBox } from '@openrent/core';
import { createDatabase, probeAppRole, migrate, migratePlugins, withSystem } from '@openrent/db';
import type { Config } from './config.ts';
import type { AppDeps } from './deps.ts';
import { createPluginHost } from './plugins.ts';
import { loadThemes } from './themes.ts';

export function readVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export async function bootstrap(config: Config, logger: any, opts: { migrate?: boolean; poolSize?: number; themes?: boolean } = {}): Promise<AppDeps> {
  if (opts.migrate ?? config.autoMigrate) {
    const r = await migrate(config.databaseMigrationUrl, { log: (m) => logger.info(m) });
    if (r.applied.length) logger.info({ applied: r.applied }, 'migrations applied');
  }
  const db = createDatabase({ connectionString: config.databaseUrl, max: opts.poolSize ?? config.dbPoolMax });
  const warning = await probeAppRole(db);
  if (warning) logger.warn(warning);
  const plugins = await createPluginHost(logger, { configPath: config.pluginsConfig, pluginsDir: config.pluginsDir });
  // Plugins' own tables come after OpenRent's migrations; a refused migration is reported, not fatal.
  if (opts.migrate ?? config.autoMigrate) {
    const r = await migratePlugins(config.databaseMigrationUrl, plugins.migrations, (m) => logger.info(m));
    for (const x of r.refused) logger.error({ plugin: x.pluginId, migration: x.name, errors: x.errors }, 'plugin migration refused');
  }
  // Hooks and event handlers of a plugin run only for tenants that have it enabled (no row = enabled).
  await plugins.useEnablementSource(async () => {
    const r = await withSystem(db, (c) => c.query<{ tenantId: string; pluginId: string }>(`SELECT tenant_id AS "tenantId", plugin_id AS "pluginId" FROM plugins WHERE NOT enabled`));
    return r.rows;
  });
  // The worker has no use for theme metadata; only the API serves it to the admin.
  const themes = opts.themes === false ? [] : loadThemes(logger, config.themesConfig ?? undefined, config.themesDir);
  return { config, db, plugins, themes, secrets: createSecretBox(config.encryptionKey), version: readVersion() };
}
