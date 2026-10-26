import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

// Return bigint columns (money in minor units) as JS numbers. Amounts stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// Return numeric as number as well (used by aggregates).
pg.types.setTypeParser(1700, (v) => Number(v));
// DATE columns stay calendar dates ("2026-12-31"); as JS Dates they would shift with the server's time zone.
pg.types.setTypeParser(1082, (v) => v);

export interface DbOptions {
  connectionString: string;
  max?: number;
  appRole?: string | null;
}

export interface Database {
  pool: pg.Pool;
  /** Role switched to with SET LOCAL ROLE for tenant work, or null when unavailable. */
  appRole: string | null;
  close(): Promise<void>;
}

export function createDatabase(opts: DbOptions): Database {
  const pool = new pg.Pool({ connectionString: opts.connectionString, max: opts.max ?? 10 });
  pool.on('error', (err) => {
    console.error('[openrent/db] idle client error', err);
  });
  return {
    pool,
    appRole: opts.appRole === undefined ? 'openrent_app' : opts.appRole,
    close: () => pool.end(),
  };
}

/**
 * Checks whether the connecting role can switch to the RLS-bound app role.
 * Returns a warning string when tenant isolation would not be enforced by the database.
 */
export async function probeAppRole(db: Database): Promise<string | null> {
  const r = await db.pool.query<{ ok: boolean | null; su: boolean; bypass: boolean }>(
    `SELECT (SELECT pg_has_role(current_user, oid, 'MEMBER') FROM pg_roles WHERE rolname = $1) AS ok,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`,
    [db.appRole ?? 'openrent_app'],
  );
  const row = r.rows[0]!;
  if (row.ok) return null;
  db.appRole = null;
  if (row.su || row.bypass) {
    return 'DATABASE_URL role bypasses row-level security and cannot switch to openrent_app; tenant isolation relies on application code only';
  }
  return null;
}

export type Isolation = 'read committed' | 'repeatable read' | 'serializable';

export interface TxOptions {
  isolation?: Isolation;
  /** Retries on serialization failure (40001) and deadlock (40P01). */
  retries?: number;
  readOnly?: boolean;
}

const RETRYABLE = new Set(['40001', '40P01']);

async function runTx<T>(
  db: Database,
  setup: (c: pg.PoolClient) => Promise<void>,
  fn: (c: pg.PoolClient) => Promise<T>,
  opts: TxOptions,
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const client = await db.pool.connect();
    try {
      const iso = opts.isolation ? ` ISOLATION LEVEL ${opts.isolation.toUpperCase()}` : '';
      await client.query(`BEGIN${iso}${opts.readOnly ? ' READ ONLY' : ''}`);
      await setup(client);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection may already be broken */
      }
      if (RETRYABLE.has(err?.code) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Runs fn inside a transaction bound to one tenant through RLS. */
export function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (c: pg.PoolClient) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  return runTx(
    db,
    async (c) => {
      if (db.appRole) await c.query(`SET LOCAL ROLE ${quoteIdent(db.appRole)}`);
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.system', 'off', true)`, [
        tenantId,
      ]);
    },
    fn,
    opts,
  );
}

/**
 * Runs fn with cross-tenant visibility. Only for explicit system paths:
 * credential resolution, host → tenant lookup and worker fan-out.
 */
export function withSystem<T>(db: Database, fn: (c: pg.PoolClient) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  return runTx(
    db,
    async (c) => {
      if (db.appRole) await c.query(`SET LOCAL ROLE ${quoteIdent(db.appRole)}`);
      await c.query(`SELECT set_config('app.system', 'on', true)`);
    },
    fn,
    opts,
  );
}

function quoteIdent(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}
