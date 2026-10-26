import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Ctx } from './context.ts';
import { readFile, type FileRow } from './files/index.ts';
import { sha256 } from './ids.ts';
import { toCsv } from './reports/index.ts';
import { listPage, many, type ListParams } from './sql.ts';

/** FR-MIG-1: full tenant export as JSON (documents included as HTML). Every row is tenant-scoped by RLS. */
export const EXPORT_TABLES = [
  'tenants', 'locations', 'location_blackouts', 'memberships', 'tax_profiles', 'price_structures', 'categories', 'products', 'product_categories',
  'variants', 'stock_items', 'stock_levels', 'stock_adjustments', 'bundles', 'bundle_components', 'customers', 'coupons', 'orders', 'order_lines',
  'order_line_units', 'order_events', 'allocations', 'downtimes', 'documents', 'document_templates', 'payments', 'deposits', 'damage_charges',
  'notification_templates', 'notifications', 'webhook_endpoints', 'webhook_events', 'audit_log', 'plugins',
];

const SECRET_COLUMNS = new Set(['secret_encrypted', 'previous_secret_encrypted', 'config_encrypted', 'client_secret_encrypted', 'credentials_encrypted', 'oauth_verifier_encrypted']);

export async function exportTenant(ctx: Ctx) {
  const out: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) {
    const rows = await many(ctx, `SELECT * FROM ${t}`);
    out[t] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLUMNS.has(k))));
  }
  return { object: 'tenant_export', format_version: 1, exported_at: ctx.now.toISOString(), tenant_id: ctx.tenantId, tables: out };
}

/**
 * Tenant tables left out of the full export: sessions and sign-in links (secrets that only matter
 * while they are valid), the event outbox, idempotency records and abandoned carts.
 */
export const EXPORT_DENYLIST = ['sessions', 'customer_sessions', 'customer_login_tokens', 'idempotency_keys', 'outbox', 'checkout_sessions'];

/** Columns never exported: credentials, token hashes and bearer tokens. Bytes and HTML go in their own folders. */
export const REDACTED_COLUMNS = new Set(['secret_encrypted', 'previous_secret_encrypted', 'config_encrypted', 'token_hash', 'key_hash', 'public_token', 'password_hash', 'totp_secret', 'totp_pending', 'code_hash', 'client_secret_encrypted', 'credentials_encrypted', 'oauth_verifier_encrypted', 'oauth_state_hash']);
const SEPARATE_COLUMNS: Record<string, string[]> = { files: ['data'], documents: ['html'] };

/** Every table with a tenant_id column (plus the tenant itself), so new tables are exported by default. */
export async function exportTableNames(ctx: Ctx): Promise<string[]> {
  const rows = await many<{ table_name: string }>(
    ctx,
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name`,
  );
  return ['tenants', ...rows.map((r) => r.table_name).filter((n) => !EXPORT_DENYLIST.includes(n) && !n.startsWith('plg_'))];
}

const ndjson = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';

/**
 * The full export as a ZIP (FR-MIG-1): manifest.json, each table as NDJSON and CSV, issued documents as
 * HTML and every stored file. Secrets are left out (REDACTED_COLUMNS).
 */
export async function exportZip(ctx: Ctx, progress: (pct: number) => void = () => undefined): Promise<{ zip: Buffer; manifest: Record<string, unknown> }> {
  const entries: Zippable = {};
  const add = (path: string, data: Uint8Array) => {
    entries[path] = data;
    return { path, size: data.length, sha256: sha256(Buffer.from(data)) };
  };
  const tables = await exportTableNames(ctx);
  const tableInfo: { name: string; rows: number; files: { path: string; size: number; sha256: string }[] }[] = [];
  const steps = tables.length + 2;
  let step = 0;
  for (const table of tables) {
    const skip = SEPARATE_COLUMNS[table] ?? [];
    const rows = (await many(ctx, `SELECT * FROM ${table}`)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !REDACTED_COLUMNS.has(k) && !skip.includes(k))));
    tableInfo.push({ name: table, rows: rows.length, files: [add(`tables/${table}.ndjson`, strToU8(ndjson(rows))), add(`tables/${table}.csv`, strToU8(toCsv(rows)))] });
    progress((++step / steps) * 100);
  }
  // Members' names and emails (users are shared across shops, so only this shop's members).
  const users = await many(ctx, `SELECT u.id, u.email, u.name, u.locale, u.status, u.created_at FROM users u JOIN memberships m ON m.user_id = u.id`);
  tableInfo.push({ name: 'users', rows: users.length, files: [add('tables/users.ndjson', strToU8(ndjson(users))), add('tables/users.csv', strToU8(toCsv(users)))] });

  const docs = await many<{ id: string; type: string; number: string | null; html: string }>(ctx, `SELECT id, type, number, html FROM documents ORDER BY created_at`);
  const documents = docs.map((d) => ({ id: d.id, ...add(`documents/${safeName(`${d.type}-${d.number ?? d.id}`)}.html`, strToU8(d.html ?? '')) }));
  progress((++step / steps) * 100);

  const stored = await many<FileRow>(ctx, `SELECT id, kind, owner_type, owner_id, filename, content_type, size, sha256, width, height, storage, key, created_at FROM files ORDER BY created_at`);
  const files: Record<string, unknown>[] = [];
  for (const f of stored) {
    try {
      const body = await readFile(ctx, f);
      files.push({ id: f.id, kind: f.kind, ...add(`files/${f.id}/${safeName(f.filename)}`, new Uint8Array(body)), expected_sha256: f.sha256 });
    } catch (err) {
      // A missing object is listed, not fatal: the export still holds everything else.
      files.push({ id: f.id, kind: f.kind, missing: true, error: String((err as Error)?.message ?? err) });
    }
  }
  progress(((step + 1) / steps) * 100);

  const manifest = {
    object: 'tenant_export',
    format_version: 2,
    exported_at: ctx.now.toISOString(),
    tenant_id: ctx.tenantId,
    tables: tableInfo,
    documents,
    files,
    redacted_columns: [...REDACTED_COLUMNS],
    left_out_tables: EXPORT_DENYLIST,
  };
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return { zip: Buffer.from(zipSync(entries, { level: 6 })), manifest };
}

/** Audit entries with the actor's display name (user name or email, API key name). */
export async function listAudit(ctx: Ctx, p: ListParams) {
  const page = await listPage(
    ctx,
    {
      table: 'audit_log',
      filters: { entity_type: 'entity_type', entity_id: 'entity_id', actor_id: 'actor_id', action: 'action', created_at: 'created_at' },
      sorts: { created_at: 'created_at' },
      defaultSort: '-created_at',
    },
    p,
  );
  const users = [...new Set(page.data.filter((r: any) => r.actor_type === 'user' && r.actor_id).map((r: any) => r.actor_id))];
  const keys = [...new Set(page.data.filter((r: any) => r.actor_type === 'api_key' && r.actor_id).map((r: any) => r.actor_id))];
  const names = new Map<string, string>();
  if (users.length) for (const u of await many<{ id: string; name: string; email: string }>(ctx, `SELECT id, name, email FROM users WHERE id = ANY($1)`, [users])) names.set(u.id, u.name || u.email);
  if (keys.length) for (const k of await many<{ id: string; name: string }>(ctx, `SELECT id, name FROM api_keys WHERE id = ANY($1)`, [keys])) names.set(k.id, k.name);
  return { ...page, data: page.data.map((r: any) => ({ ...r, actor_name: r.actor_id ? names.get(r.actor_id) ?? null : null })) };
}
