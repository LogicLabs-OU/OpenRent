import { attachments, maintenance, orders, inventory, type Ctx } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Type } from '../schemas.ts';

const Visibility = Type.Union([Type.Literal('internal'), Type.Literal('customer')], { description: 'customer shows the file in the customer’s account and on the order page' });
const Kind = Type.Union([Type.Literal('attachment'), Type.Literal('insurance'), Type.Literal('id_document')]);
const AttachBody = Type.Object({ file_id: Id, label: Type.Optional(Type.String({ maxLength: 200 })), visibility: Type.Optional(Visibility), kind: Type.Optional(Kind) }, { additionalProperties: false });
const PatchBody = Type.Partial(Type.Object({ label: Type.String({ maxLength: 200 }), visibility: Visibility, kind: Kind }), { additionalProperties: false });
const OwnedParams = Type.Object({ id: Type.String(), attachment_id: Id });

/** Attachments on orders, customers and units (FR-OR-13), and unit photos (FR-CAT-4). */
export function registerAttachments(r: Router) {
  const owners: { path: string; type: attachments.OwnerType; read: 'orders:read' | 'customers:read' | 'inventory:read'; write: 'orders:write' | 'customers:write' | 'inventory:write'; tag: string; resolve: (ctx: Ctx, id: string) => Promise<string> }[] = [
    { path: 'orders', type: 'order', read: 'orders:read', write: 'orders:write', tag: 'Orders', resolve: (ctx, id) => orders.resolveOrderId(ctx, id) },
    { path: 'customers', type: 'customer', read: 'customers:read', write: 'customers:write', tag: 'Customers', resolve: async (_c, id) => id },
    { path: 'stock_items', type: 'stock_item', read: 'inventory:read', write: 'inventory:write', tag: 'Inventory', resolve: async (_c, id) => id },
  ];
  for (const o of owners) {
    const tags = [o.tag, 'Attachments'];
    r.get(`/${o.path}/:id/attachments`, { permission: o.read, tags, summary: 'Attached files', params: Type.Object({ id: Type.String() }) }, async (ctx, req) => ({
      object: 'list',
      data: await attachments.listAttachments(ctx, o.type, await o.resolve(ctx, req.params.id)),
    }));
    r.post(`/${o.path}/:id/attachments`, { permission: o.write, tags, summary: 'Attach an uploaded file (POST /files?purpose=attachment first)', params: Type.Object({ id: Type.String() }), body: AttachBody }, async (ctx, req) =>
      attachments.addAttachment(ctx, o.type, await o.resolve(ctx, req.params.id), req.body),
    );
    r.patch(`/${o.path}/:id/attachments/:attachment_id`, { permission: o.write, tags, summary: 'Rename an attachment or change who sees it', params: OwnedParams, body: PatchBody }, async (ctx, req) =>
      attachments.updateAttachment(ctx, o.type, await o.resolve(ctx, req.params.id), req.params.attachment_id, req.body),
    );
    r.delete(`/${o.path}/:id/attachments/:attachment_id`, { permission: o.write, tags, summary: 'Remove an attachment and its file', params: OwnedParams }, async (ctx, req) =>
      attachments.removeAttachment(ctx, o.type, await o.resolve(ctx, req.params.id), req.params.attachment_id),
    );
    r.get(`/${o.path}/:id/attachments/:attachment_id/content`, { permission: o.read, tags, summary: 'Download an attachment', params: OwnedParams, raw: true }, async (ctx, req, reply) => {
      const { file, body } = await attachments.attachmentFile(ctx, o.type, await o.resolve(ctx, req.params.id), req.params.attachment_id);
      return reply.type(file.content_type).header('Cache-Control', 'private, max-age=300').header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`).send(body);
    });
  }

  r.post('/stock_items/:id/photos', { permission: 'inventory:write', tags: ['Inventory'], summary: 'Add a photo to a unit (POST /files?purpose=photo first)', params: IdParams, body: Type.Object({ file_id: Id }) }, async (ctx, req) => {
    await inventory.getStockItem(ctx, req.params.id);
    return maintenance.attachPhoto(ctx, 'stock_item', req.params.id, req.body.file_id);
  });
}
