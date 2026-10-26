import { inspections } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Nullable, Type } from '../schemas.ts';

/** Inspection checklists (FR-MNT-3): templates per category, and checklist runs per unit. */
export function registerInspections(r: Router) {
  const I = ['Inspections'];
  const Item = Type.Object(
    {
      key: Type.Optional(Type.String({ maxLength: 40 })), label: Type.Record(Type.String({ maxLength: 10 }), Type.String({ maxLength: 200 })),
      kind: Type.String({ description: 'check, number or text' }), required: Type.Optional(Type.Boolean()),
      min: Type.Optional(Nullable(Type.Number())), max: Type.Optional(Nullable(Type.Number())),
      fail_status: Type.Optional(Type.String({ description: 'needs_inspection, soft_down (default) or hard_down' })),
    },
    { additionalProperties: false },
  );
  const Body = { name: Type.String({ maxLength: 200 }), items: Type.Array(Item, { maxItems: 100 }), category_ids: Type.Optional(Type.Array(Id, { maxItems: 100 })), active: Type.Optional(Type.Boolean()) };
  r.get('/inspection_templates', { permission: 'inventory:read', tags: I, summary: 'Checklist templates' }, async (ctx) => ({ object: 'list', data: await inspections.listTemplates(ctx) }));
  r.post('/inspection_templates', { permission: 'inventory:write', tags: I, summary: 'Create a checklist template', body: Type.Object(Body, { additionalProperties: false }) }, async (ctx, req) =>
    inspections.createTemplate(ctx, req.body as any),
  );
  r.get('/inspection_templates/:id', { permission: 'inventory:read', tags: I, summary: 'One checklist template', params: IdParams }, async (ctx, req) => inspections.getTemplate(ctx, req.params.id));
  r.patch('/inspection_templates/:id', { permission: 'inventory:write', tags: I, summary: 'Update a template (changed items make a new version)', params: IdParams, body: Type.Partial(Type.Object(Body, { additionalProperties: false })) }, async (ctx, req) =>
    inspections.updateTemplate(ctx, req.params.id, req.body as any),
  );
  r.delete('/inspection_templates/:id', { permission: 'inventory:write', tags: I, summary: 'Archive a template (past inspections keep their copy)', params: IdParams }, async (ctx, req) => inspections.deleteTemplate(ctx, req.params.id));
  r.get('/stock_items/:id/inspection_template', { permission: 'inventory:read', tags: I, summary: "The checklist that applies to a unit (null when none)", params: IdParams }, async (ctx, req) => ({
    object: 'result',
    template: await inspections.templateFor(ctx, req.params.id),
  }));
  r.get('/stock_items/:id/inspections', { permission: 'inventory:read', tags: I, summary: "A unit's inspections, newest first", params: IdParams }, async (ctx, req) => ({ object: 'list', data: await inspections.listInspections(ctx, req.params.id) }));
  r.post(
    '/stock_items/:id/inspections',
    {
      permission: 'inventory:write', tags: I, summary: 'Run a checklist on a unit; failures take it out of service with a ticket', params: IdParams,
      body: Type.Object(
        {
          template_id: Type.Optional(Id), order_id: Type.Optional(Nullable(Id)),
          results: Type.Array(Type.Object({ key: Type.String({ maxLength: 40 }), passed: Type.Optional(Type.Boolean()), value: Type.Optional(Nullable(Type.Union([Type.Number(), Type.String({ maxLength: 2000 })]))), note: Type.Optional(Type.String({ maxLength: 2000 })) }), { maxItems: 100 }),
        },
        { additionalProperties: false },
      ),
    },
    async (ctx, req) => inspections.runInspection(ctx, req.params.id, req.body),
  );
}
