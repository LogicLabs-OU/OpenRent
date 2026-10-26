import { staffNotices } from '@openrent/core';
import type { Router } from '../http.ts';
import { IdParams, Type } from '../schemas.ts';

/** The signed-in staff member's own notices and notification preferences (FR-NOT-3). */
export function registerMe(r: Router) {
  const T = ['Notifications'];
  r.get(
    '/me/notifications',
    { tags: T, summary: 'Your in-app notices, newest first, with the unread count', querystring: Type.Object({ unread: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }) },
    async (ctx, req) => staffNotices.myNotices(ctx, req.query),
  );
  r.post('/me/notifications/:id/actions/read', { tags: T, summary: 'Mark a notice as read', params: IdParams, status: 200 }, async (ctx, req) => staffNotices.markNoticeRead(ctx, req.params.id));
  r.post('/me/notifications/actions/read_all', { tags: T, summary: 'Mark all your notices as read', status: 200 }, async (ctx) => staffNotices.markAllNoticesRead(ctx));
  r.get('/me/notification_preferences', { tags: T, summary: 'Which notices you get in the admin and by email' }, async (ctx) => staffNotices.myPreferences(ctx));
  r.patch(
    '/me/notification_preferences',
    { tags: T, summary: 'Turn notices on or off per kind', body: Type.Object({ kinds: Type.Array(Type.Object({ kind: Type.String(), in_app: Type.Optional(Type.Boolean()), email: Type.Optional(Type.Boolean()) }), { maxItems: 50 }) }) },
    async (ctx, req) => staffNotices.setMyPreferences(ctx, req.body),
  );
}
