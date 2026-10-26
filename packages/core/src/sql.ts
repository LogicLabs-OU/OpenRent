import { t as msg } from './i18n/index.ts';
import type { Ctx } from './context.ts';
import { AppError, mapDbError, notFound } from './errors.ts';

export async function many<T = any>(ctx: Pick<Ctx, 'db'>, text: string, values: unknown[] = []): Promise<T[]> {
  try {
    return (await ctx.db.query<T>(text, values)).rows;
  } catch (err) {
    throw mapDbError(err) ?? err;
  }
}

export async function one<T = any>(ctx: Pick<Ctx, 'db'>, text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await many<T>(ctx, text, values);
  return rows[0] ?? null;
}

export async function must<T = any>(
  ctx: Pick<Ctx, 'db'>,
  text: string,
  values: unknown[],
  entity: string,
  id?: string,
): Promise<T> {
  const row = await one<T>(ctx, text, values);
  if (!row) throw notFound(entity, id);
  return row;
}

export async function exec(ctx: Pick<Ctx, 'db'>, text: string, values: unknown[] = []): Promise<number> {
  try {
    return (await ctx.db.query(text, values)).rowCount ?? 0;
  } catch (err) {
    throw mapDbError(err) ?? err;
  }
}

/** JSON-encode for jsonb parameters (pg would turn JS arrays into Postgres array literals). */
export const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

export interface ColumnSpec {
  json?: boolean;
}

/**
 * Builds an INSERT for whitelisted columns. Returns the SQL and values.
 */
export function insertSql(
  table: string,
  row: Record<string, unknown>,
  columns: Record<string, ColumnSpec>,
): { text: string; values: unknown[] } {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined && (k in columns || k === 'id' || k === 'tenant_id'));
  const values = keys.map((k) => (columns[k]?.json ? json(row[k]) : row[k]));
  const text = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
  return { text, values };
}

/**
 * Builds `SET a = $n, ...` for whitelisted columns present in patch.
 */
export function updateSql(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  columns: Record<string, ColumnSpec>,
  extraWhere = '',
): { text: string; values: unknown[] } | null {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined && k in columns);
  if (keys.length === 0) return null;
  const values: unknown[] = keys.map((k) => (columns[k]?.json ? json(patch[k]) : patch[k]));
  values.push(id);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  return { text: `UPDATE ${table} SET ${sets} WHERE id = $${values.length} ${extraWhere} RETURNING *`, values };
}

/** Opaque cursor (offset based for the MVP; clients must treat it as opaque). */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof v.o === 'number' && v.o >= 0) return v.o;
  } catch {
    /* fallthrough */
  }
  throw new AppError('invalid_cursor', 400, msg('error.the_cursor_is_not_valid'));
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface ListParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  filters?: Record<string, FilterValue>;
  q?: string;
}

export interface FilterValue {
  eq?: string[];
  gte?: string;
  lte?: string;
  gt?: string;
  lt?: string;
}

export interface ListSpec {
  table: string;
  /** Filter name → SQL column expression. */
  filters: Record<string, string>;
  /** Sort name → SQL column expression. */
  sorts: Record<string, string>;
  defaultSort: string;
  /** SQL expression matched with ILIKE for ?q= */
  search?: string[];
  baseWhere?: string;
  select?: string;
}

/** Generic cursor-paginated list with the PRD §5.1 filter grammar. */
export async function listPage<T>(ctx: Pick<Ctx, 'db'>, spec: ListSpec, p: ListParams): Promise<Page<T>> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const offset = decodeCursor(p.cursor);
  const where: string[] = [spec.baseWhere ?? 'true'];
  const values: unknown[] = [];
  for (const [name, f] of Object.entries(p.filters ?? {})) {
    const col = spec.filters[name];
    if (!col) throw new AppError('unknown_filter', 400, msg('error.unknown_filter', { name }), { extra: { allowed: Object.keys(spec.filters) } });
    if (f.eq?.length) {
      values.push(f.eq);
      where.push(`${col}::text = ANY($${values.length})`);
    }
    for (const op of ['gte', 'lte', 'gt', 'lt'] as const) {
      if (f[op] !== undefined) {
        values.push(f[op]);
        const sym = { gte: '>=', lte: '<=', gt: '>', lt: '<' }[op];
        where.push(`${col} ${sym} $${values.length}`);
      }
    }
  }
  let rank: string | null = null;
  if (p.q && spec.search?.length) {
    values.push(`%${p.q}%`);
    where.push(`(${spec.search.map((c) => `${c} ILIKE $${values.length}`).join(' OR ')})`);
    // Without an explicit sort, prefix matches on the first search column come first.
    if (!p.sort) {
      values.push(`${p.q}%`);
      rank = `CASE WHEN ${spec.search[0]} ILIKE $${values.length} OR ${spec.search[0]} ILIKE '% ' || $${values.length} THEN 0 ELSE 1 END ASC`;
    }
  }
  const order = (p.sort ?? spec.defaultSort)
    .split(',')
    .filter(Boolean)
    .map((s) => {
      const desc = s.startsWith('-');
      const key = desc ? s.slice(1) : s;
      const col = spec.sorts[key];
      if (!col) throw new AppError('unknown_sort', 400, msg('error.cannot_sort_by', { key }), { extra: { allowed: Object.keys(spec.sorts) } });
      return `${col} ${desc ? 'DESC' : 'ASC'}`;
    });
  if (rank) order.unshift(rank);
  order.push('id ASC');
  values.push(limit + 1, offset);
  const rows = await many<T>(
    ctx,
    `SELECT ${spec.select ?? '*'} FROM ${spec.table} WHERE ${where.join(' AND ')} ORDER BY ${order.join(', ')} LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  const has_more = rows.length > limit;
  return { data: rows.slice(0, limit), has_more, next_cursor: has_more ? encodeCursor(offset + limit) : null };
}

/** Every row of a list with its filters (list exports, FR-INT-2); refuses more than `max` rows. */
export async function allPages<T>(fetch: (p: ListParams) => Promise<Page<T>>, p: ListParams, max = 10_000): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch({ ...p, limit: 200, cursor });
    out.push(...page.data);
    if (out.length > max) throw new AppError('export_too_large', 422, msg('error.export_too_large', { max }));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

export function mapPage<A, B>(page: Page<A>, fn: (a: A) => B): Page<B> {
  return { ...page, data: page.data.map(fn) };
}
