import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

/** OPENRENT_MIGRATIONS_DIR, else `migrations/` next to a bundled build, else the package's own folder. */
export const MIGRATIONS_DIR =
  process.env.OPENRENT_MIGRATIONS_DIR ??
  [new URL('./migrations/', import.meta.url), new URL('../migrations/', import.meta.url)].map((u) => fileURLToPath(u)).find((d) => existsSync(d)) ??
  fileURLToPath(new URL('../migrations/', import.meta.url));
/** Idempotent RLS, grant and trigger invariants re-applied after every migrate. */
export const INVARIANTS_FILE =
  process.env.OPENRENT_INVARIANTS_FILE ??
  [new URL('./sql/invariants.sql', import.meta.url), new URL('../sql/invariants.sql', import.meta.url)].map((u) => fileURLToPath(u)).find((f) => existsSync(f)) ??
  fileURLToPath(new URL('../sql/invariants.sql', import.meta.url));
const LOCK_KEY = 7_340_211; // advisory lock id for migrations

export interface MigrationResult {
  applied: string[];
  pending: string[];
}

async function listMigrations(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  // 0001_init.sql (hand-reviewed baseline) sorts before drizzle-kit's timestamped files.
  return files.filter((f) => /^\d+_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
}

export async function migrate(
  connectionString: string,
  opts: { dryRun?: boolean; dir?: string; log?: (m: string) => void } = {},
): Promise<MigrationResult> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? console.log;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const all = await listMigrations(dir);
    const pending = all.filter((m) => !done.has(m));
    if (opts.dryRun) return { applied: [], pending };
    const applied: string[] = [];
    for (const name of pending) {
      const sql = await readFile(path.join(dir, name), 'utf8');
      log(`migrate: applying ${name}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${name} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(name);
    }
    if (existsSync(INVARIANTS_FILE)) await client.query(await readFile(INVARIANTS_FILE, 'utf8'));
    return { applied, pending: [] };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

export async function rollback(connectionString: string, opts: { dir?: string; log?: (m: string) => void } = {}) {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? console.log;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    const last = (
      await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')
    ).rows[0];
    if (!last) return null;
    const down = last.name.replace(/\.sql$/, '.down.sql');
    if (!existsSync(path.join(dir, down))) throw new Error(`${last.name} has no ${down}; generated migrations are forward-only, restore from backup or write a new migration`);
    const sql = await readFile(path.join(dir, down), 'utf8');
    log(`rollback: reverting ${last.name}`);
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [last.name]);
    await client.query('COMMIT');
    return last.name;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
