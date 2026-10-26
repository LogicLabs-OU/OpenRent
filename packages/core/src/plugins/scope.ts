import type { HookContext, PluginScope } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { emit } from '../events.ts';
import { pluginConfig } from './index.ts';

/**
 * What one plugin reaches from a hook, route or schedule (FR-PLG-3). The database handle is a guard
 * rail, not a sandbox: it keeps plugins inside the shop's row-level security and their own tables,
 * and stops them from changing session settings, roles or the schema.
 */
export const pluginPrefix = (pluginId: string) => `plg_${pluginId.replace(/-/g, '_')}_`;

/** Why a plugin's query is refused, or null. String literals and comments are not looked at. */
export function refusePluginSql(pluginId: string, sql: string): string | null {
  const code = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''")
    .toLowerCase();
  if (/;\s*\S/.test(code)) return 'one statement per query';
  if (/^\s*(set|reset|do|begin|start|commit|rollback|savepoint|release|prepare|execute|deallocate|discard|listen|notify|lock|vacuum|analyze|cluster|reindex|refresh|copy|create|alter|drop|truncate|grant|revoke|comment|security|load)\b/.test(code))
    return 'only SELECT, INSERT, UPDATE and DELETE are allowed';
  if (/\b(set_config|current_setting|pg_read_file|pg_ls_dir|pg_terminate_backend|lo_import|lo_export|dblink)\s*\(/.test(code)) return 'session and server functions are not allowed';
  const writes = code
    .replace(/\bdo\s+update\s+set\b/g, ' ')
    .replace(/\bfor\s+(no\s+key\s+)?update\b/g, ' ');
  const own = pluginPrefix(pluginId);
  for (const m of writes.matchAll(/\b(insert\s+into|update|delete\s+from|merge\s+into)\s+(?:only\s+)?("?[a-z0-9_]+"?\.)?"?([a-z0-9_]+)"?/g)) {
    if (!m[3]!.startsWith(own)) return `plugins may only write to their own ${own} tables (not ${m[3]})`;
  }
  return null;
}

export function pluginScope(ctx: Ctx, pluginId: string): PluginScope {
  return {
    db: {
      async query(sql, values = []) {
        const refused = refusePluginSql(pluginId, sql);
        if (refused) throw new Error(`plugin ${pluginId}: ${refused}`);
        // A failing plugin query must not abort the core transaction it runs in.
        await ctx.db.query('SAVEPOINT plugin_query');
        try {
          const r = await ctx.db.query(sql, values as unknown[]);
          await ctx.db.query('RELEASE SAVEPOINT plugin_query');
          return { rows: r.rows };
        } catch (err) {
          await ctx.db.query('ROLLBACK TO SAVEPOINT plugin_query');
          throw err;
        }
      },
    },
    services: {
      getOrder: async (id) => (await import('../orders/index.ts')).getOrder(ctx, id),
      getCustomer: async (id) => (await import('../customers/index.ts')).getCustomer(ctx, id),
      getProduct: async (id) => (await import('../catalog/index.ts')).getProduct(ctx, id),
    },
    config: async () => (await pluginConfig(ctx, pluginId)).config,
    secrets: {
      async get(key) {
        const v = (await pluginConfig(ctx, pluginId)).config[key];
        return typeof v === 'string' ? v : null;
      },
    },
    events: {
      async emit(type, object) {
        if (!type.startsWith(`plugin.${pluginId}.`) || !/^[a-z0-9_.-]+$/.test(type)) throw new Error(`plugin ${pluginId}: events must be named plugin.${pluginId}.<name>`);
        await emit(ctx, type, { type: 'plugin', id: pluginId }, object);
      },
    },
  };
}

/** The context hooks get: each plugin receives its own scope from `scopeFor`. */
export function hookContext(ctx: Ctx): HookContext {
  return { tenantId: ctx.tenantId, actor: ctx.actor, logger: ctx.logger, scopeFor: (pluginId) => pluginScope(ctx, pluginId) };
}
