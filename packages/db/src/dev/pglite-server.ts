/**
 * Development-only PostgreSQL stand-in: PGlite (Postgres compiled to WASM) behind a
 * wire-protocol socket. Lets contributors try OpenRent without installing Postgres.
 * It is single-backend, so it cannot prove concurrency behaviour; use real PostgreSQL 16 for that.
 *
 *   pnpm --filter @openrent/db pglite [--port 7432] [--data ./data/pglite] [--max-connections 6]
 *
 * Run the API with DATABASE_POOL_MAX=1. Concurrent connections are multiplexed onto one backend.
 */
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * pglite-socket gives the one backend to another connection between any two messages unless a transaction
 * is open. Outside one, a query is several messages (Parse, Bind, Describe, Execute, Sync); when another
 * connection's Parse comes between them, the first one's statement is gone and it fails, or waits for an
 * answer that never comes. This keeps the backend with a connection from its first message to its Sync,
 * through the queue's own rule that it serves the connection holding an open transaction first.
 */
function keepQueriesTogether(db: PGlite) {
  let open = false;
  const inTransaction = db.isInTransaction.bind(db);
  const raw = db.execProtocolRawStream.bind(db);
  const exec = db.exec.bind(db);
  db.isInTransaction = () => open || inTransaction();
  db.execProtocolRawStream = async (message, options) => {
    const type = String.fromCharCode(message[0] ?? 0);
    try {
      return await raw(message, options);
    } finally {
      if (type === 'S' || type === 'Q' || type === 'X') open = false;
      else if ('PBDEC'.includes(type)) open = true;
    }
  };
  // The queue rolls back a connection that went away mid-transaction; that also ends a half-sent query.
  db.exec = ((query: string, options?: any) => {
    if (query === 'ROLLBACK') open = false;
    return exec(query, options);
  }) as PGlite['exec'];
}

export async function startPglite(opts: { port?: number; dataDir?: string; maxConnections?: number } = {}) {
  const db = await PGlite.create(opts.dataDir ?? 'memory://', { extensions: { btree_gist, pg_trgm } });
  keepQueriesTogether(db);
  const server = new PGLiteSocketServer({ db, port: opts.port ?? 7432, host: '127.0.0.1', maxConnections: opts.maxConnections ?? 1 });
  await server.start();
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${opts.port ?? 7432}/postgres?sslmode=disable`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const s = await startPglite({ port: Number(arg('--port') ?? 7432), dataDir: arg('--data'), maxConnections: Number(arg('--max-connections') ?? 1) });
  console.log(`PGlite listening. DATABASE_URL=${s.url}`);
  process.on('SIGINT', async () => {
    await s.stop();
    process.exit(0);
  });
}
