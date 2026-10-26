import type { Ctx } from './context.ts';
import { audit, emit } from './events.ts';
import { newId, type IdPrefix } from './ids.ts';
import { exec, insertSql, listPage, many, must, updateSql, type ColumnSpec, type ListParams, type ListSpec, type Page } from './sql.ts';

export interface CrudSpec<Api> {
  table: string;
  prefix: IdPrefix;
  entity: string;
  columns: Record<string, ColumnSpec>;
  softDelete?: boolean;
  /** Event name prefix, e.g. `coupon` → coupon.created / coupon.updated / coupon.deleted */
  event?: string;
  list: Omit<ListSpec, 'table'>;
  defaults?: (ctx: Ctx) => Promise<Record<string, unknown>> | Record<string, unknown>;
  toApi: (row: any) => Api;
  beforeWrite?: (ctx: Ctx, data: Record<string, any>, existing: any | null) => Promise<void> | void;
}

export function makeCrud<Api>(spec: CrudSpec<Api>) {
  const alive = spec.softDelete ? 'deleted_at IS NULL' : 'true';
  const get = async (ctx: Ctx, id: string): Promise<any> =>
    must(ctx, `SELECT * FROM ${spec.table} WHERE id = $1 AND ${alive}`, [id], spec.entity, id);

  return {
    spec,
    getRow: get,
    async list(ctx: Ctx, p: ListParams): Promise<Page<Api>> {
      const page = await listPage<any>(ctx, { table: spec.table, ...spec.list, baseWhere: [alive, spec.list.baseWhere].filter(Boolean).join(' AND ') }, p);
      return { ...page, data: page.data.map(spec.toApi) };
    },
    async get(ctx: Ctx, id: string): Promise<Api> {
      return spec.toApi(await get(ctx, id));
    },
    async create(ctx: Ctx, input: Record<string, any>): Promise<Api> {
      const data = { ...(spec.defaults ? await spec.defaults(ctx) : {}), ...input };
      await spec.beforeWrite?.(ctx, data, null);
      const q = insertSql(spec.table, { ...data, id: newId(spec.prefix), tenant_id: ctx.tenantId }, spec.columns);
      const row = (await many(ctx, q.text, q.values))[0];
      await audit(ctx, { entity_type: spec.entity, entity_id: row.id, action: 'create', after: row });
      const api = spec.toApi(row);
      if (spec.event) await emit(ctx, `${spec.event}.created`, { type: spec.entity, id: row.id }, api);
      return api;
    },
    async update(ctx: Ctx, id: string, patch: Record<string, any>): Promise<Api> {
      const before = await get(ctx, id);
      await spec.beforeWrite?.(ctx, patch, before);
      const q = updateSql(spec.table, id, patch, spec.columns);
      if (!q) return spec.toApi(before);
      const after = (await many(ctx, q.text, q.values))[0];
      await audit(ctx, { entity_type: spec.entity, entity_id: id, action: 'update', before, after });
      const api = spec.toApi(after);
      if (spec.event) await emit(ctx, `${spec.event}.updated`, { type: spec.entity, id }, api);
      return api;
    },
    async remove(ctx: Ctx, id: string): Promise<void> {
      const before = await get(ctx, id);
      if (spec.softDelete) await exec(ctx, `UPDATE ${spec.table} SET deleted_at = now() WHERE id = $1`, [id]);
      else await exec(ctx, `DELETE FROM ${spec.table} WHERE id = $1`, [id]);
      await audit(ctx, { entity_type: spec.entity, entity_id: id, action: 'delete', before });
      if (spec.event) await emit(ctx, `${spec.event}.deleted`, { type: spec.entity, id }, { id, object: spec.entity, deleted: true });
    },
  };
}

export const money = (amount: number | null | undefined, currency: string) => ({ amount: Number(amount ?? 0), currency: currency.trim() });
