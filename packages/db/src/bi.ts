import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * Database logins for BI tools (FR-REP-5): one PostgreSQL role per login, a member of `openrent_bi`,
 * which may read the views in schema `bi` and nothing else (sql/invariants.sql). Roles are made on the
 * migration connection, whose role needs CREATEROLE. Passwords reach the database only as SCRAM
 * verifiers, so they never show in its statement log.
 */
export interface BiRoles {
  /** Why logins cannot be made: the migrations made no BI views, or the role may not create roles. */
  problem(): Promise<'no_views' | 'no_createrole' | null>;
  create(role: string, password: string): Promise<void>;
  setPassword(role: string, password: string): Promise<void>;
  drop(role: string): Promise<void>;
}

const ROLE = /^openrent_bi_[a-z0-9]{8,32}$/;

/** A SCRAM-SHA-256 verifier as PostgreSQL stores it (RFC 5802, 7677). */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

const ident = (role: string) => {
  if (!ROLE.test(role)) throw new Error(`not a BI login: ${role}`);
  return `"${role}"`;
};

export function biRoles(connectionString: string): BiRoles {
  async function run<T>(fn: (c: pg.Client) => Promise<T>) {
    const c = new pg.Client({ connectionString });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }
  return {
    problem: () =>
      run(async (c) => {
        const r = (
          await c.query<{ group: boolean; admin: boolean | null; create: boolean; views: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openrent_bi') AS group,
                    (SELECT pg_has_role(current_user, 'openrent_bi', 'MEMBER WITH ADMIN OPTION') FROM pg_roles WHERE rolname = 'openrent_bi') AS admin,
                    (SELECT rolcreaterole OR rolsuper FROM pg_roles WHERE rolname = current_user) AS create,
                    to_regnamespace('bi') IS NOT NULL AS views`,
          )
        ).rows[0]!;
        if (!r.group || !r.views) return 'no_views' as const;
        if (!r.create || !r.admin) return 'no_createrole' as const;
        return null;
      }),
    create: (role, password) =>
      run(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(`CREATE ROLE ${ident(role)} LOGIN PASSWORD '${scramVerifier(password)}' CONNECTION LIMIT 5 IN ROLE openrent_bi`);
          await c.query(`ALTER ROLE ${ident(role)} SET default_transaction_read_only = on`);
          await c.query(`ALTER ROLE ${ident(role)} SET statement_timeout = '120s'`);
          await c.query(`ALTER ROLE ${ident(role)} SET search_path = bi`);
          await c.query('COMMIT');
        } catch (err) {
          await c.query('ROLLBACK');
          throw err;
        }
      }),
    setPassword: (role, password) => run(async (c) => void (await c.query(`ALTER ROLE ${ident(role)} PASSWORD '${scramVerifier(password)}'`))),
    drop: (role) =>
      run(async (c) => {
        // Open sessions end with the login; without the right to end them, they end when they disconnect.
        await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1`, [role]).catch(() => undefined);
        await c.query(`DROP ROLE IF EXISTS ${ident(role)}`);
      }),
  };
}
