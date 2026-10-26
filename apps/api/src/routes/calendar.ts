import { AppError, calendar, serverT } from '@openrent/core';
import { withSystem, withTenant } from '@openrent/db';
import type { Router } from '../http.ts';
import { IdParams, Nullable, Type } from '../schemas.ts';
import { systemCtx } from '../context.ts';

/** iCal feeds of pickups and returns for staff calendars (FR-INT-2). */
export function registerCalendar(r: Router) {
  const C = ['Calendar feeds'];
  r.get(
    '/calendar_feeds',
    {
      permission: 'tenant:write',
      tags: C,
      summary: 'Active calendar feeds (their URLs are shown only when created); ?stock_item_id= for one unit',
      querystring: Type.Object({ stock_item_id: Type.Optional(Type.String()) }),
    },
    async (ctx, req) => ({ object: 'list', data: await calendar.listFeeds(ctx, req.query.stock_item_id) }),
  );
  r.post(
    '/calendar_feeds',
    {
      permission: 'tenant:write',
      tags: C,
      summary: 'Create a feed of pickups and returns, or of one unit (stock_item_id); the response holds its secret URL once',
      body: Type.Object({
        name: Type.String({ maxLength: 100 }),
        location_id: Type.Optional(Nullable(Type.String())),
        stock_item_id: Type.Optional(Nullable(Type.String())),
      }),
    },
    async (ctx, req) => calendar.createFeed(ctx, req.body),
  );
  r.delete(
    '/calendar_feeds/:id',
    {
      permission: 'tenant:write',
      tags: C,
      summary: 'Revoke a feed; its URL stops working at once',
      params: IdParams,
      status: 200,
    },
    async (ctx, req) => calendar.revokeFeed(ctx, req.params.id),
  );

  // The URL token is the key: no session or shop header, so calendar apps can subscribe.
  r.get(
    '/calendar/:file',
    {
      public: true,
      tx: 'none',
      tags: C,
      summary: 'The feed as iCalendar (text/calendar)',
      params: Type.Object({ file: Type.String({ pattern: '^[A-Za-z0-9_-]{16,64}\\.ics$' }) }),
      raw: true,
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
    async (_ctx, req, reply) => {
      const deps = r.deps;
      const token = req.params.file.replace(/\.ics$/, '');
      const feed = await withSystem(deps.db, (c) => calendar.feedByToken(c, token));
      if (!feed) throw new AppError('not_found', 404, serverT('calendar.not_found'));
      const ics = await withTenant(deps.db, feed.tenant_id, async (c) => {
        const ctx = systemCtx(deps, c, feed.tenant_id, req.log);
        return calendar.toIcs(feed.name, await calendar.feedEvents(ctx, feed), ctx.now);
      });
      return reply
        .type('text/calendar; charset=utf-8')
        .header('Cache-Control', 'private, max-age=300')
        .header('Content-Disposition', 'inline; filename="openrent.ics"')
        .send(ics);
    },
  );
}
