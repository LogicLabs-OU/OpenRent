import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { startPglite } from '../src/dev/pglite-server.ts';

describe('PGlite stand-in', () => {
  // Outside a transaction a query is several messages; another connection's must not come between them,
  // or the query fails ("unnamed prepared statement does not exist") or never gets its answer.
  it('keeps each connection’s queries whole while others run transactions', async () => {
    const s = await startPglite({ port: 21000 + Math.floor(Math.random() * 8000), maxConnections: 8 });
    const pool = new pg.Pool({ connectionString: s.url, max: 4 });
    const problems: string[] = [];
    try {
      await pool.query('CREATE TABLE t (id int PRIMARY KEY, v int)');
      await pool.query('INSERT INTO t SELECT g, 0 FROM generate_series(1, 50) g');
      const tx = async (i: number) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [`t${i % 3}`]);
          await c.query('SELECT * FROM t WHERE id = $1', [1 + (i % 50)]);
          if (i % 7 === 0) await c.query('UPDATE t SET v = v + 1 WHERE id = $1', [1 + (i % 50)]);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      };
      // A text of its own per query, so a statement taken over by another connection shows.
      const single = async (i: number) => {
        const r = await pool.query<{ n: number }>(`SELECT $1::int + ${i % 5} AS n`, [i]);
        if (r.rows[0]?.n !== i + (i % 5)) throw new Error(`wrong answer ${r.rows[0]?.n}`);
      };
      const running = new Set<Promise<unknown>>();
      for (let i = 0; i < 800; i++) {
        const p: Promise<unknown> = Promise.race([i % 4 === 0 ? single(i) : tx(i), new Promise((_, no) => setTimeout(() => no(new Error('no answer')), 8000))])
          .catch((err: Error) => problems.push(`${i}: ${err.message}`))
          .finally(() => running.delete(p));
        running.add(p);
        if (running.size >= 12) await Promise.race(running);
      }
      await Promise.all(running);
      expect(problems).toEqual([]);
    } finally {
      await Promise.race([pool.end().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
      await Promise.race([s.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
    }
  }, 60_000);
});
