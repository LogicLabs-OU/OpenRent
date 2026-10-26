import { parseArgs } from 'node:util';
import { files, plugins, serverT, type Ctx } from '@openrent/core';
import { loadDotEnv, migrate, migratePlugins, withTenant } from '@openrent/db';
import { bootstrap } from '@openrent/api/bootstrap';
import { ConfigError, loadConfig } from '@openrent/api/config';
import { backup, restore, tenantIds, type Tools } from './backup.ts';
import { checkPlugin, packPlugin } from './plugin-kit.ts';
import { checkTheme, installTheme, packTheme } from './theme-kit.ts';

/**
 * `openrent`: operator commands for a self-hosted installation (PRD §10.5).
 *   migrate [--dry-run]                       apply database migrations
 *   backup --out DIR [--with-files]           pg_dump plus a file manifest (and copies of stored files)
 *   restore DIR --yes | --check               load a backup, or only check files against it
 *   files migrate-storage [--tenant ID]       move files kept in the database to S3/MinIO
 *   files verify [--tenant ID]                check a sample of stored files
 *   plugin disable|enable ID [--tenant ID]    turn a plugin off or on for one or every shop
 *   plugin check [DIR] | plugin pack [DIR]    check a plugin folder, or check and zip it for upload
 *   theme check [DIR] | theme pack [DIR]      check a theme folder, or check and zip it
 *   theme install ZIP                         put a code theme into THEMES_DIR (then rebuild the storefront)
 */
const say = (line: string) => process.stdout.write(`${line}\n`);
const fail = (line: string): never => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};

loadDotEnv();
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    tenant: { type: 'string' },
    batch: { type: 'string' },
    'with-files': { type: 'boolean' },
    'pg-dump': { type: 'string' },
    'pg-restore': { type: 'string' },
    'dry-run': { type: 'boolean' },
    yes: { type: 'boolean' },
    check: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [cmd, sub, arg] = positionals;

if (!cmd || values.help || cmd === 'help') {
  say(serverT('cli.usage'));
  process.exit(cmd ? 0 : 1);
}

// Plugin development commands work on a folder and need no database.
if (cmd === 'plugin' && (sub === 'check' || sub === 'pack')) {
  const dir = arg ?? '.';
  const r: Awaited<ReturnType<typeof checkPlugin>> & { file?: string | null } = sub === 'check' ? await checkPlugin(dir) : await packPlugin(dir, values.out);
  for (const w of r.warnings) say(serverT('cli.plugin_warning', { text: w }));
  for (const e of r.errors) process.stderr.write(`${serverT('cli.plugin_error', { text: e })}\n`);
  if (!r.errors.length) say(sub === 'check' ? serverT('cli.plugin_ok', { id: r.manifest!.id, version: r.manifest!.version }) : serverT('cli.plugin_packed', { file: r.file ?? '' }));
  process.exit(r.errors.length ? 1 : 0);
}

// Theme commands work on folders and ZIPs; `install` needs only THEMES_DIR.
if (cmd === 'theme' && (sub === 'check' || sub === 'pack' || sub === 'install')) {
  let r: Awaited<ReturnType<typeof checkTheme>> & { file?: string | null; dir?: string | null };
  if (sub === 'install') {
    if (!arg) fail(serverT('cli.need_dir'));
    if (!process.env.THEMES_DIR) fail(serverT('cli.theme_dir_missing'));
    r = await installTheme(arg!, process.env.THEMES_DIR!).catch((err) => fail((err as Error).message));
  } else r = sub === 'check' ? await checkTheme(arg ?? '.') : await packTheme(arg ?? '.', values.out);
  for (const w of r.warnings) say(serverT('cli.plugin_warning', { text: w }));
  for (const e of r.errors) process.stderr.write(`${serverT('cli.plugin_error', { text: e })}\n`);
  if (!r.errors.length) say(sub === 'check' ? serverT('cli.plugin_ok', { id: r.id!, version: r.version! }) : sub === 'pack' ? serverT('cli.plugin_packed', { file: r.file! }) : serverT('cli.theme_installed', { id: r.id!, dir: r.dir! }));
  process.exit(r.errors.length ? 1 : 0);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) fail(err.message);
  throw err;
}

if (cmd === 'migrate') {
  const r = await migrate(config.databaseMigrationUrl, { dryRun: values['dry-run'], log: say });
  say(values['dry-run'] ? serverT('cli.pending', { list: r.pending.join(', ') || '—' }) : serverT('cli.applied', { list: r.applied.join(', ') || '—' }));
  if (!values['dry-run']) {
    // Plugins' migrations run with the plugins loaded, like at API start.
    const deps = await bootstrap(config, { info() {}, warn() {}, error() {}, debug() {} }, { migrate: false, poolSize: 1, themes: false });
    const p = await migratePlugins(config.databaseMigrationUrl, deps.plugins.migrations, say);
    await deps.db.close();
    process.exit(p.refused.length ? 1 : 0);
  }
  process.exit(0);
}

const quiet = { info() {}, warn: (o: unknown, m?: string) => process.stderr.write(`${m ?? ''} ${JSON.stringify(o)}\n`), error: (o: unknown, m?: string) => process.stderr.write(`${m ?? ''} ${JSON.stringify(o)}\n`), debug() {} };
const deps = await bootstrap(config, quiet, { migrate: false, poolSize: 2, themes: false });
const tenantCtx: Tools['tenantCtx'] = (tenantId, fn) =>
  withTenant(deps.db, tenantId, (c) =>
    fn({ db: c, tenantId, actor: { type: 'system', id: null }, now: new Date(), plugins: deps.plugins, secrets: deps.secrets, config: { publicUrl: config.publicUrl, adminUrl: config.adminUrl, storefrontUrl: config.storefrontUrl, livemode: config.livemode }, logger: quiet } as Ctx),
  );
const tools: Tools = { db: deps.db, tenantCtx, databaseUrl: config.databaseMigrationUrl, say };
let code = 0;
try {
  if (cmd === 'backup') {
    if (!values.out) fail(serverT('cli.need_out'));
    await backup(tools, { out: values.out!, withFiles: values['with-files'], pgDump: values['pg-dump'] });
  } else if (cmd === 'restore') {
    if (!sub) fail(serverT('cli.need_dir'));
    if (!values.yes && !values.check) fail(serverT('cli.restore_confirm'));
    const r = await restore(tools, { dir: sub!, pgRestore: values['pg-restore'], checkOnly: values.check });
    code = r.problems.length ? 1 : 0;
  } else if (cmd === 'files' && sub === 'migrate-storage') {
    const batch = Number(values.batch ?? 50);
    for (const id of await tenantIds(deps.db, values.tenant)) {
      let moved = 0;
      for (let n = -1; n !== 0; moved += n) n = await tenantCtx(id, (ctx) => files.migrateToStorage(ctx, batch));
      say(serverT('cli.moved', { tenant: id, count: String(moved) }));
    }
  } else if (cmd === 'files' && sub === 'verify') {
    for (const id of await tenantIds(deps.db, values.tenant)) {
      const missing = await tenantCtx(id, (ctx) => files.verifyStorage(ctx, 500));
      say(serverT('cli.verified', { tenant: id, missing: String(missing.length) }));
      for (const m of missing) say(`  ${m}`);
      if (missing.length) code = 1;
    }
  } else if (cmd === 'plugin' && (sub === 'disable' || sub === 'enable') && arg) {
    if (!deps.plugins.statuses.some((p) => p.id === arg)) fail(serverT('plugins.not_installed', { id: arg }));
    const ids = await tenantIds(deps.db, values.tenant);
    for (const id of ids) await tenantCtx(id, (ctx) => plugins.updatePlugin(ctx, deps.plugins.statuses, arg, { enabled: sub === 'enable' }));
    say(serverT(sub === 'enable' ? 'cli.plugin_enabled' : 'cli.plugin_disabled', { id: arg, count: String(ids.length) }));
  } else {
    say(serverT('cli.usage'));
    code = 1;
  }
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  code = 1;
} finally {
  await deps.db.close();
}
process.exit(code);
