import type { Ctx } from '../context.ts';
import { AppError, invalid, notFound, type FieldError } from '../errors.ts';
import { audit, emit } from '../events.ts';
import { newId } from '../ids.ts';
import { t as msg } from '../i18n/index.ts';
import { exec, json, many, must, one } from '../sql.ts';
import { setStockItemStatus, type StockStatus } from '../inventory/index.ts';
import { openTicketOf } from '../maintenance/tickets.ts';

/**
 * Inspection checklists (FR-MNT-3). A template lists what to check on the units of some categories; an
 * inspection records one run on one unit, with a copy of the template it used. A failed item takes the
 * unit out of service (which opens a repair ticket); a unit waiting for inspection goes back into
 * service once everything passes.
 */
export type ItemKind = 'check' | 'number' | 'text';
export type FailStatus = 'needs_inspection' | 'soft_down' | 'hard_down';
const KINDS: ItemKind[] = ['check', 'number', 'text'];
const FAIL: FailStatus[] = ['needs_inspection', 'soft_down', 'hard_down'];

export interface TemplateItem {
  key: string;
  /** The label per language; the shop's language must be there. */
  label: Record<string, string>;
  kind: ItemKind;
  required?: boolean;
  /** Numbers outside these bounds fail the item. */
  min?: number | null;
  max?: number | null;
  /** Where a failed item sends the unit (default soft_down). */
  fail_status?: FailStatus;
}

export interface TemplateInput {
  name?: string;
  items?: TemplateItem[];
  category_ids?: string[];
  active?: boolean;
}

export interface ResultInput {
  key: string;
  passed?: boolean;
  value?: number | string | null;
  note?: string;
}

export function templateToApi(r: any) {
  return {
    id: r.id, object: 'inspection_template', name: r.name, items: r.items ?? [], category_ids: r.category_ids ?? [], version: r.version, active: r.active,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

export function inspectionToApi(r: any) {
  return {
    id: r.id, object: 'inspection', stock_item_id: r.stock_item_id, barcode: r.barcode ?? null, template_id: r.template_id, template_version: r.template_version,
    template: r.template, results: r.results ?? [], passed: r.passed, order_id: r.order_id, ticket_id: r.ticket_id,
    performed_by: r.performed_by ? { id: r.performed_by, name: r.performer_name ?? null } : null, created_at: r.created_at,
  };
}

const keyOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'item';

async function shopLocale(ctx: Ctx) {
  return (await must<{ locale: string }>(ctx, `SELECT locale FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant')).locale;
}

/** Checks a template; items get stable keys from their label when they have none. */
async function cleanTemplate(ctx: Ctx, input: TemplateInput, partial: boolean) {
  const errors: FieldError[] = [];
  const locale = await shopLocale(ctx);
  if ((!partial || input.name !== undefined) && !input.name?.trim()) errors.push({ field: 'name', code: 'required', message: msg('error.field.enter_a_name') });
  let items: TemplateItem[] | undefined;
  if (!partial || input.items !== undefined) {
    if (!input.items?.length) errors.push({ field: 'items', code: 'required', message: msg('error.field.checklist_items') });
    const keys = new Set<string>();
    items = (input.items ?? []).map((it, i) => {
      const label = Object.fromEntries(Object.entries(it.label ?? {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));
      if (!label[locale]) errors.push({ field: `items[${i}].label`, code: 'required', message: msg('error.field.checklist_label', { locale }) });
      if (!KINDS.includes(it.kind)) errors.push({ field: `items[${i}].kind`, code: 'invalid', message: msg('error.field.checklist_kind') });
      if (it.fail_status && !FAIL.includes(it.fail_status)) errors.push({ field: `items[${i}].fail_status`, code: 'invalid', message: msg('error.field.checklist_fail_status') });
      if (it.kind === 'number' && it.min != null && it.max != null && Number(it.min) > Number(it.max)) errors.push({ field: `items[${i}].max`, code: 'invalid_range', message: msg('error.field.checklist_max_below_min') });
      let key = it.key?.trim() ? keyOf(it.key) : keyOf(label[locale] ?? `item_${i + 1}`);
      while (keys.has(key)) key = `${key}_${i + 1}`;
      keys.add(key);
      return {
        key, label, kind: it.kind, required: it.required ?? true,
        ...(it.kind === 'number' ? { min: it.min ?? null, max: it.max ?? null } : {}),
        fail_status: it.fail_status ?? 'soft_down',
      };
    });
  }
  const categoryIds = input.category_ids === undefined ? undefined : [...new Set(input.category_ids)];
  if (categoryIds?.length) {
    const found = new Set((await many<{ id: string }>(ctx, `SELECT id FROM categories WHERE id = ANY($1)`, [categoryIds])).map((c) => c.id));
    categoryIds.forEach((id, i) => !found.has(id) && errors.push({ field: `category_ids[${i}]`, code: 'not_found', message: msg('error.field.unknown_category') }));
  }
  if (errors.length) throw invalid(msg('error.check_the_checklist'), errors);
  return { name: input.name?.trim(), items, categoryIds };
}

export async function listTemplates(ctx: Ctx) {
  return (await many(ctx, `SELECT * FROM inspection_templates WHERE deleted_at IS NULL ORDER BY name`)).map(templateToApi);
}

export async function getTemplate(ctx: Ctx, id: string) {
  return templateToApi(await must(ctx, `SELECT * FROM inspection_templates WHERE id = $1 AND deleted_at IS NULL`, [id], 'inspection_template', id));
}

export async function createTemplate(ctx: Ctx, input: TemplateInput) {
  const c = await cleanTemplate(ctx, input, false);
  const row = (
    await many(ctx, `INSERT INTO inspection_templates (id, tenant_id, name, items, category_ids, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [
      newId('itp'), ctx.tenantId, c.name, json(c.items), c.categoryIds ?? [], input.active ?? true,
    ])
  )[0];
  await audit(ctx, { entity_type: 'inspection_template', entity_id: row.id, action: 'create', after: row });
  return templateToApi(row);
}

/** Changing the items makes a new version; inspections already done keep theirs. */
export async function updateTemplate(ctx: Ctx, id: string, input: TemplateInput) {
  const before = await must<any>(ctx, `SELECT * FROM inspection_templates WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id], 'inspection_template', id);
  const c = await cleanTemplate(ctx, input, true);
  const itemsChanged = c.items !== undefined && JSON.stringify(c.items) !== JSON.stringify(before.items);
  const after = (
    await many(
      ctx,
      `UPDATE inspection_templates SET name = coalesce($2, name), items = coalesce($3, items), category_ids = coalesce($4, category_ids),
              active = coalesce($5, active), version = version + $6 WHERE id = $1 RETURNING *`,
      [id, c.name ?? null, c.items ? json(c.items) : null, c.categoryIds ?? null, input.active ?? null, itemsChanged ? 1 : 0],
    )
  )[0];
  await audit(ctx, { entity_type: 'inspection_template', entity_id: id, action: 'update', before, after });
  return templateToApi(after);
}

export async function deleteTemplate(ctx: Ctx, id: string) {
  const before = await must<any>(ctx, `SELECT * FROM inspection_templates WHERE id = $1 AND deleted_at IS NULL`, [id], 'inspection_template', id);
  await exec(ctx, `UPDATE inspection_templates SET deleted_at = now(), active = false WHERE id = $1`, [id]);
  await audit(ctx, { entity_type: 'inspection_template', entity_id: id, action: 'delete', before });
}

/** The checklist for a unit: one for its product's categories, else one for every product (no categories). */
export async function templateFor(ctx: Ctx, stockItemId: string) {
  const r = await one(
    ctx,
    `SELECT it.* FROM inspection_templates it, stock_items s JOIN variants v ON v.id = s.variant_id
      WHERE s.id = $1 AND it.deleted_at IS NULL AND it.active
        AND (it.category_ids = '{}' OR it.category_ids && (SELECT coalesce(array_agg(category_id), '{}') FROM product_categories WHERE product_id = v.product_id))
      ORDER BY it.category_ids = '{}', it.name LIMIT 1`,
    [stockItemId],
  );
  return r ? templateToApi(r) : null;
}

/** Inspections of a unit, newest first. */
export async function listInspections(ctx: Ctx, stockItemId: string) {
  return (
    await many(
      ctx,
      `SELECT i.*, s.barcode, u.name AS performer_name FROM inspections i JOIN stock_items s ON s.id = i.stock_item_id LEFT JOIN users u ON u.id = i.performed_by
        WHERE i.stock_item_id = $1 ORDER BY i.created_at DESC LIMIT 100`,
      [stockItemId],
    )
  ).map(inspectionToApi);
}

/** Where failed items send the unit: the worst of them. */
const worst = (s: FailStatus[]) => FAIL[Math.max(...s.map((x) => FAIL.indexOf(x)))]!;

/**
 * Runs a checklist on a unit (FR-MNT-3). Every required item needs a result; a check fails when not
 * passed, a number when outside its bounds. A failure takes the unit out of service with a ticket that
 * lists the failed items; a pass brings a unit that was waiting for inspection back into service.
 */
export async function runInspection(ctx: Ctx, stockItemId: string, input: { template_id?: string; results: ResultInput[]; order_id?: string | null }) {
  const unit = await must<any>(ctx, `SELECT id, barcode, status FROM stock_items WHERE id = $1 FOR UPDATE`, [stockItemId], 'stock_item', stockItemId);
  if (['out', 'in_transit', 'retired', 'lost'].includes(unit.status))
    throw new AppError('unit_unavailable', 409, msg('error.inspection_unit_status', { barcode: unit.barcode, status: msg(`stock.status.${unit.status as StockStatus}`) }));
  const tpl = input.template_id ? await getTemplate(ctx, input.template_id) : await templateFor(ctx, stockItemId);
  if (!tpl) throw notFound('inspection_template');
  const locale = await shopLocale(ctx);
  const given = new Map((input.results ?? []).map((r) => [r.key, r]));
  const errors: FieldError[] = [];
  const results = (tpl.items as TemplateItem[]).map((it) => {
    const r = given.get(it.key);
    const field = `results.${it.key}`;
    const note = r?.note?.trim() || undefined;
    if (it.kind === 'check') {
      if (typeof r?.passed !== 'boolean') {
        if (it.required) errors.push({ field, code: 'required', message: msg('error.field.checklist_answer') });
        return { key: it.key, passed: true, value: null, note, skipped: true };
      }
      return { key: it.key, passed: r.passed, value: null, note };
    }
    if (it.kind === 'number') {
      const v = r?.value === '' || r?.value == null ? null : Number(r.value);
      if (v == null || Number.isNaN(v)) {
        if (it.required || (r?.value != null && r.value !== '')) errors.push({ field, code: 'required', message: msg('error.field.checklist_number') });
        return { key: it.key, passed: true, value: null, note, skipped: true };
      }
      const ok = (it.min == null || v >= it.min) && (it.max == null || v <= it.max);
      return { key: it.key, passed: typeof r?.passed === 'boolean' ? r.passed && ok : ok, value: v, note };
    }
    const text = typeof r?.value === 'string' ? r.value.trim() : '';
    if (!text && it.required) errors.push({ field, code: 'required', message: msg('error.field.checklist_answer') });
    return { key: it.key, passed: r?.passed !== false, value: text || null, note };
  });
  if (errors.length) throw invalid(msg('error.check_the_checklist'), errors);
  const failed = (tpl.items as TemplateItem[]).filter((it, i) => !results[i]!.passed);
  const passed = failed.length === 0;
  const label = (it: TemplateItem) => it.label[locale] ?? Object.values(it.label)[0] ?? it.key;

  let ticketId: string | null = null;
  if (!passed) {
    const reason = msg('inspection.failed_reason', { name: tpl.name, items: failed.map(label).join(', ') });
    await setStockItemStatus(ctx, unit.id, worst(failed.map((f) => f.fail_status ?? 'soft_down')), reason, { system: true });
    ticketId = (await openTicketOf(ctx, unit.id))?.id ?? null;
  } else if (unit.status === 'needs_inspection') {
    await setStockItemStatus(ctx, unit.id, 'available', msg('inspection.passed_reason', { name: tpl.name }), { system: true });
  }

  const id = newId('ins');
  await exec(
    ctx,
    `INSERT INTO inspections (id, tenant_id, stock_item_id, template_id, template_version, template, results, passed, order_id, ticket_id, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, ctx.tenantId, unit.id, tpl.id, tpl.version, json({ name: tpl.name, items: tpl.items }), json(results), passed, input.order_id ?? null, ticketId, ctx.actor.type === 'user' ? ctx.actor.id : null],
  );
  const api = inspectionToApi({ ...(await must(ctx, `SELECT i.*, s.barcode FROM inspections i JOIN stock_items s ON s.id = i.stock_item_id WHERE i.id = $1`, [id], 'inspection')) });
  await audit(ctx, { entity_type: 'inspection', entity_id: id, action: 'create', after: api });
  await emit(ctx, 'inspection.completed', { type: 'stock_item', id: unit.id }, api);
  return api;
}

/** With require_inspection_on_return, a unit that has a checklist comes back waiting for inspection. */
export async function needsInspectionOnReturn(ctx: Ctx, stockItemId: string, required: boolean) {
  return required && !!(await templateFor(ctx, stockItemId));
}
