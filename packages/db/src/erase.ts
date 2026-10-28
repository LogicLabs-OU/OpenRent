import pg from 'pg';
import { biRoles } from './bi.ts';

/**
 * Erases one shop and everything it holds (managed cloud: a shop that asked to be deleted). Runs on
 * the owner connection as the `openrent_maintenance` role, the only one the append-only tables (audit
 * log, accounting entries, issued documents, inspections, signatures) let remove rows, and only for
 * the shop named in `openrent.erasing_tenant`. Tables are emptied in whatever order their foreign
 * keys allow, in one transaction: it all goes, or nothing does.
 */
export async function eraseTenant(connectionString: string, tenantId: string, log: (m: string) => void = () => undefined): Promise<{ tables: number; rows: number }> {
  const c = new pg.Client({ connectionString });
  await c.connect();
  try {
    await c.query('BEGIN');
    const member = (await c.query(`SELECT pg_has_role(current_user, 'openrent_maintenance', 'MEMBER') AS ok`).catch(() => ({ rows: [{ ok: false }] }))).rows[0]?.ok;
    if (!member) throw new Error('The database user cannot erase shops: grant it the openrent_maintenance role (see docs/guide/operations.md)');
    await c.query(`SELECT set_config('app.system', 'on', true), set_config('openrent.erasing_tenant', $1, true)`, [tenantId]);
    const members: string[] = (await c.query(`SELECT user_id FROM memberships WHERE tenant_id = $1`, [tenantId])).rows.map((r) => r.user_id);
    const logins: string[] = (await c.query(`SELECT role_name FROM bi_access WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] }))).rows.map((r: any) => r.role_name);
    let left: string[] = (
      await c.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'tenants' ORDER BY c.relname`,
      )
    ).rows.map((r) => r.relname);
    const tables = left.length;
    let rows = 0;
    while (left.length) {
      const blocked: string[] = [];
      for (const t of left) {
        await c.query('SAVEPOINT erase');
        try {
          rows += (await c.query(`DELETE FROM "${t.replace(/"/g, '""')}" WHERE tenant_id = $1`, [tenantId])).rowCount ?? 0;
          await c.query('RELEASE SAVEPOINT erase');
        } catch (err: any) {
          await c.query('ROLLBACK TO SAVEPOINT erase');
          // Another table still points at these rows: try again after the others.
          if (err?.code !== '23503') throw err;
          blocked.push(t);
        }
      }
      if (blocked.length === left.length) throw new Error(`Cannot erase shop ${tenantId}: ${blocked.join(', ')} are still referenced`);
      left = blocked;
    }
    rows += (await c.query(`DELETE FROM tenants WHERE id = $1`, [tenantId])).rowCount ?? 0;
    // Staff accounts that belonged to no other shop go too (with their sign-in links and sessions).
    for (const id of members) {
      if ((await c.query(`SELECT 1 FROM memberships WHERE user_id = $1 LIMIT 1`, [id])).rowCount) continue;
      await c.query('SAVEPOINT erase_user');
      try {
        await c.query(`DELETE FROM login_tokens WHERE user_id = $1`, [id]);
        await c.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
        rows += (await c.query(`DELETE FROM users WHERE id = $1`, [id])).rowCount ?? 0;
        await c.query('RELEASE SAVEPOINT erase_user');
      } catch (err: any) {
        await c.query('ROLLBACK TO SAVEPOINT erase_user');
        if (err?.code !== '23503') throw err;
      }
    }
    await c.query('COMMIT');
    // The shop's BI logins (database roles) go too, after the commit, so a role that cannot be removed does not stop the erase.
    for (const role of logins) await biRoles(connectionString).drop(role).catch((err) => log(`BI login ${role} not removed: ${(err as Error).message}`));
    log(`erased shop ${tenantId}: ${rows} rows in ${tables} tables`);
    return { tables, rows };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}
