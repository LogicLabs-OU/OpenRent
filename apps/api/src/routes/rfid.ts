import { rfid } from '@openrent/core';
import type { Router } from '../http.ts';
import { Id, IdParams, Nullable, Type } from '../schemas.ts';

/** RFID (FR-SCAN-7): unit tags, readers and taking every read unit at once. Reads arrive at /webhooks/rfid/{reader}. */
export function registerRfid(r: Router) {
  const S = ['Scanning'];
  r.get('/stock_items/:id/rfid_tags', { permission: 'inventory:read', tags: S, summary: "The unit's RFID tags (EPCs)", params: IdParams }, async (ctx, req) => ({
    object: 'rfid_tags',
    stock_item_id: req.params.id,
    epcs: await rfid.unitTags(ctx, req.params.id),
  }));
  r.put(
    '/stock_items/:id/rfid_tags',
    {
      permission: 'inventory:write',
      tags: S,
      summary: "Replace the unit's RFID tags; a tag on another unit is refused",
      params: IdParams,
      body: Type.Object({ epcs: Type.Array(Type.String({ maxLength: 80 }), { maxItems: 20, description: 'EPCs in hex; spaces, dashes and colons are dropped' }) }, { additionalProperties: false }),
    },
    async (ctx, req) => rfid.setUnitTags(ctx, req.params.id, req.body),
  );
  r.post(
    '/scans/tags',
    {
      permission: 'orders:fulfil',
      tags: S,
      summary: 'Take every unit the tags belong to at once: onto the order at pickup (check_out), or back from their orders (check_in)',
      body: Type.Object(
        { epcs: Type.Array(Type.String({ maxLength: 80 }), { minItems: 1, maxItems: 2000 }), mode: Type.Union([Type.Literal('check_out'), Type.Literal('check_in')]), order_id: Type.Optional(Nullable(Id)) },
        { additionalProperties: false },
      ),
      status: 200,
    },
    async (ctx, req) => rfid.scanTags(ctx, req.body),
  );
  r.get('/rfid/formats', { permission: 'inventory:read', tags: S, summary: 'Message formats readers can post in: OpenRent’s own and those of the shop’s RFID plugins' }, async (ctx) => ({
    object: 'list',
    data: await rfid.readerFormats(ctx),
  }));
  r.get('/rfid/readers', { permission: 'inventory:read', tags: S, summary: 'RFID readers (their tokens are shown only when added)' }, async (ctx) => ({ object: 'list', data: await rfid.listReaders(ctx) }));
  r.post(
    '/rfid/readers',
    {
      permission: 'inventory:write',
      tags: S,
      summary: 'Add a reader; the response holds the address and the token its bridge posts reads with, once',
      body: Type.Object({ name: Type.String({ maxLength: 100 }), location_id: Type.Optional(Nullable(Id)), format: Type.Optional(Type.String({ maxLength: 64 })) }, { additionalProperties: false }),
      status: 201,
    },
    async (ctx, req) => rfid.createReader(ctx, req.body),
  );
  r.delete('/rfid/readers/:id', { permission: 'inventory:write', tags: S, summary: 'Remove a reader; its token stops working', params: IdParams, status: 200 }, async (ctx, req) => rfid.revokeReader(ctx, req.params.id));
  r.get(
    '/rfid/readers/:id/reads',
    {
      permission: 'inventory:read',
      tags: S,
      summary: 'What the reader has read since a time, as units and unknown tags (the scan page asks each second while reading)',
      params: IdParams,
      querystring: Type.Object({ since: Type.Optional(Type.String({ format: 'date-time' })) }),
    },
    async (ctx, req) => rfid.readsSince(ctx, req.params.id, req.query.since ?? ''),
  );
}
