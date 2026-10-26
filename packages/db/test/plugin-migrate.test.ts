import { describe, expect, it } from 'vitest';
import { checkPluginSql, pluginPrefix } from '../src/plugin-migrate.ts';

describe('plugin migration check', () => {
  it('accepts work on the plugin’s own tables', () => {
    expect(pluginPrefix('loyalty-points')).toBe('plg_loyalty_points_');
    const sql = `
      -- points per customer
      CREATE TABLE IF NOT EXISTS plg_loyalty_points_balances (id text PRIMARY KEY, tenant_id text NOT NULL, customer_id text REFERENCES customers(id), points int NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX plg_loyalty_points_balances_customer ON plg_loyalty_points_balances (tenant_id, customer_id);
      ALTER TABLE plg_loyalty_points_balances ADD COLUMN updated_at timestamptz;
      COMMENT ON TABLE "plg_loyalty_points_balances" IS 'points';`;
    expect(checkPluginSql('loyalty-points', sql)).toEqual([]);
  });

  it('refuses other tables, functions, roles and tables without tenant_id', () => {
    const errors = checkPluginSql('loyalty-points', `
      CREATE TABLE plg_loyalty_points_global (id text PRIMARY KEY);
      ALTER TABLE orders ADD COLUMN points int;
      DROP TABLE customers;
      CREATE FUNCTION plg_loyalty_points_f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;
      GRANT ALL ON plg_loyalty_points_x TO public;
      CREATE INDEX other_name ON plg_loyalty_points_x (id);
      INSERT INTO plg_other_plugin_x VALUES (1)`);
    expect(errors).toHaveLength(7);
    expect(errors[0]).toContain('tenant_id');
    expect(errors[1]).toContain('does not work on a plg_loyalty_points_ table');
    expect(errors[3]).toContain('may not run');
  });
});
