import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { files, serverT, type Ctx } from '@openrent/core';
import { migrate, withSystem, type Database } from '@openrent/db';

/**
 * Backups (PRD §10.5): a pg_dump of the whole database plus a manifest of every stored file with its
 * checksum, and optionally a copy of the files kept in object storage. Restore checks the dump against
 * the manifest, loads it, runs newer migrations and then checks (or puts back) every stored file.
 */
export interface Tools {
  db: Database;
  /** A core context for one tenant (system actor), opened by the caller with the app's plugins. */
  tenantCtx: <T>(tenantId: string, fn: (ctx: Ctx) => Promise<T>) => Promise<T>;
  databaseUrl: string;
  say: (line: string) => void;
}

export interface FileEntry {
  id: string;
  tenant_id: string;
  kind: string;
  filename: string;
  size: number;
  sha256: string;
  storage: string;
  key: string | null;
  copy?: string;
}

export interface Manifest {
  object: 'openrent_backup';
  format_version: 1;
  created_at: string;
  migrations: string[];
  database: { file: string; size: number; sha256: string };
  files: FileEntry[];
  file_copies: boolean;
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (err: any) => reject(err.code === 'ENOENT' ? new Error(serverT('cli.tool_missing', { tool: cmd })) : err));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(serverT('cli.tool_failed', { tool: cmd, code: String(code) })))));
  });
}

export async function backup(t: Tools, opts: { out: string; withFiles?: boolean; pgDump?: string }): Promise<Manifest> {
  if (existsSync(opts.out) && (await readdir(opts.out)).length) throw new Error(serverT('cli.out_not_empty', { dir: opts.out }));
  await mkdir(opts.out, { recursive: true });
  const dumpFile = path.join(opts.out, 'database.dump');
  t.say(serverT('cli.dumping'));
  await run(opts.pgDump ?? 'pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpFile}`, t.databaseUrl]);
  const { migrations, rows } = await withSystem(t.db, async (c) => ({
    migrations: (await c.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY name`)).rows.map((r) => r.name),
    rows: (await c.query<FileEntry>(`SELECT id, tenant_id, kind, filename, size, sha256, storage, key FROM files ORDER BY tenant_id, created_at`)).rows,
  }));
  if (opts.withFiles) {
    const external = rows.filter((f) => f.storage !== 'database');
    t.say(serverT('cli.copying_files', { count: String(external.length) }));
    await mkdir(path.join(opts.out, 'files'), { recursive: true });
    for (const f of external) {
      const body = await t.tenantCtx(f.tenant_id, async (ctx) => files.readFile(ctx, (await files.findById(ctx, f.id))!));
      if (createHash('sha256').update(body).digest('hex') !== f.sha256) throw new Error(serverT('cli.file_checksum', { id: f.id }));
      f.copy = `files/${f.id}`;
      await writeFile(path.join(opts.out, f.copy), body);
    }
  }
  const manifest: Manifest = {
    object: 'openrent_backup',
    format_version: 1,
    created_at: new Date().toISOString(),
    migrations,
    database: { file: 'database.dump', size: (await stat(dumpFile)).size, sha256: await sha256File(dumpFile) },
    files: rows,
    file_copies: !!opts.withFiles,
  };
  await writeFile(path.join(opts.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  t.say(serverT('cli.backup_done', { dir: opts.out, files: String(rows.length) }));
  return manifest;
}

export interface RestoreReport {
  restored: boolean;
  checked: number;
  rewritten: string[];
  problems: string[];
}

export async function readManifest(dir: string): Promise<Manifest> {
  const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (m.object !== 'openrent_backup' || m.format_version !== 1) throw new Error(serverT('cli.not_a_backup', { dir }));
  return m;
}

/** Restores the dump (unless `checkOnly`) and checks every file of the manifest against the database and storage. */
export async function restore(t: Tools, opts: { dir: string; pgRestore?: string; checkOnly?: boolean; migrationsDir?: string }): Promise<RestoreReport> {
  const m = await readManifest(opts.dir);
  const dumpFile = path.join(opts.dir, m.database.file);
  if ((await sha256File(dumpFile)) !== m.database.sha256) throw new Error(serverT('cli.dump_checksum'));
  if (!opts.checkOnly) {
    t.say(serverT('cli.restoring'));
    await run(opts.pgRestore ?? 'pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', `--dbname=${t.databaseUrl}`, dumpFile]);
    await migrate(t.databaseUrl, { log: t.say, ...(opts.migrationsDir ? { dir: opts.migrationsDir } : {}) });
  }
  const report: RestoreReport = { restored: !opts.checkOnly, checked: 0, rewritten: [], problems: [] };
  for (const entry of m.files) {
    report.checked++;
    await t.tenantCtx(entry.tenant_id, async (ctx) => {
      const row = await files.findById(ctx, entry.id);
      if (!row) return void report.problems.push(serverT('cli.problem.row_missing', { id: entry.id }));
      if (row.sha256 !== entry.sha256 || Number(row.size) !== Number(entry.size)) return void report.problems.push(serverT('cli.problem.changed', { id: entry.id }));
      const state = await files.storedObjectState(ctx, row);
      if (state !== 'missing') return;
      if (entry.copy && existsSync(path.join(opts.dir, entry.copy))) {
        await files.writeStoredObject(ctx, row, await readFile(path.join(opts.dir, entry.copy)));
        report.rewritten.push(entry.id);
      } else report.problems.push(serverT('cli.problem.object_missing', { id: entry.id, key: entry.key ?? '' }));
    });
  }
  t.say(serverT('cli.restore_done', { checked: String(report.checked), rewritten: String(report.rewritten.length), problems: String(report.problems.length) }));
  for (const p of report.problems) t.say(`  ${p}`);
  return report;
}

/** Tenant ids, for commands that run per shop. */
export async function tenantIds(db: Database, only?: string): Promise<string[]> {
  return withSystem(db, async (c) => (await c.query<{ id: string }>(`SELECT id FROM tenants WHERE ($1::text IS NULL OR id = $1) ORDER BY created_at`, [only ?? null])).rows.map((r) => r.id));
}

