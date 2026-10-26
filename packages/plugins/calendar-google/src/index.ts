import { definePlugin, RetryLater, type IntegrationContext, type IntegrationOrder, type IntegrationProvider, type IntegrationResult } from '@openrent/plugin-sdk';

/**
 * Google Calendar (FR-INT-4): each booking's pickup and return become events on the shop's calendar,
 * or on one calendar per location. They move when the dates change and go when the booking is
 * cancelled. Each event's link keeps the calendar it is on and a digest of what was sent, so unchanged
 * bookings cost no calls.
 */
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com';
/** Bookings that hold their dates have events; drafts, quotes and cancelled ones have none. */
export const BOOKED = ['reserved', 'prepared', 'out', 'returned_partial', 'returned', 'closed'];
const MOMENTS = ['pickup', 'return'] as const;
export type Moment = (typeof MOMENTS)[number];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The calendar for a booking's location: `location_calendars` ("Tallinn = id; Tartu = id") or the main one. */
export function calendarFor(location: { id: string; name: string }, settings: Record<string, unknown>) {
  for (const pair of String(settings.location_calendars ?? '').split(/[\n;]+/)) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const key = pair.slice(0, at).trim().toLowerCase();
    const cal = pair.slice(at + 1).trim();
    if (cal && (key === location.id.toLowerCase() || key === location.name.trim().toLowerCase())) return cal;
  }
  return str(settings.calendar_id) ?? 'primary';
}

/** `{number}`, `{customer}` and `{location}` filled in; a missing customer drops its separator. */
export function title(template: string, o: IntegrationOrder) {
  const customer = o.contact?.company_name || o.contact?.name || '';
  return template.replace(/\{number\}/g, String(o.number)).replace(/\{location\}/g, o.location.name).replace(/\s*[·\-|]?\s*\{customer\}/g, customer ? ` · ${customer}` : '').trim();
}

export function eventFor(o: IntegrationOrder, moment: Moment, settings: Record<string, unknown>) {
  const at = moment === 'pickup' ? o.starts_at : o.ends_at;
  const minutes = Math.min(1440, Math.max(5, Number(settings.event_minutes) || 30));
  const template = moment === 'pickup' ? (str(settings.pickup_title) ?? 'Pickup #{number} · {customer}') : (str(settings.return_title) ?? 'Return #{number} · {customer}');
  const contact = o.contact ? [o.contact.name, o.contact.phone, o.contact.email].filter(Boolean).join(' · ') : '';
  return {
    summary: title(template, o),
    description: [...o.lines.map((l) => `${l.quantity} × ${l.description}`), contact].filter(Boolean).join('\n').slice(0, 8000),
    location: o.location.name,
    start: { dateTime: new Date(at).toISOString() },
    end: { dateTime: new Date(Date.parse(at) + minutes * 60_000).toISOString() },
    extendedProperties: { private: { openrent_order: o.id, openrent_moment: moment } },
  };
}

/** A short digest of what was sent (FNV-1a), to skip calls when nothing changed. */
export function digest(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

async function call(ctx: IntegrationContext, method: string, path: string, body?: unknown, gone: number[] = []) {
  const res = await ctx.fetch(`${str(ctx.config.api_base_url) ?? API}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (gone.includes(res.status)) return null;
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  const reason = data?.error?.errors?.[0]?.reason;
  if (res.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    throw new RetryLater('Google Calendar asked to wait', Number(res.headers?.get('retry-after') ?? 30) * 1000);
  }
  if (!res.ok) throw new Error(`Google Calendar: ${data?.error?.message ?? `HTTP ${res.status}`}`);
  return data;
}

const events = (calendar: string) => `/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`;

/** Brings one of the booking's events in line; returns what was done. */
async function sync(ctx: IntegrationContext, o: IntegrationOrder, moment: Moment, wanted: boolean) {
  const type = `order_${moment}`;
  const link = await ctx.links.get(type, o.id);
  const live = link && !link.extra.deleted && link.remoteId ? link : null;
  if (!wanted) {
    if (!live) return 'none';
    await call(ctx, 'DELETE', `${events(String(live.extra.calendar))}/${encodeURIComponent(live.remoteId)}`, undefined, [404, 410]);
    await ctx.links.set(type, o.id, live.remoteId, { deleted: true });
    return 'removed';
  }
  const calendar = calendarFor(o.location, ctx.connection.settings);
  const body = eventFor(o, moment, ctx.connection.settings);
  const hash = digest(JSON.stringify(body));
  if (live && live.extra.calendar === calendar) {
    if (live.extra.hash === hash) return 'same';
    // Deleted by hand in Google Calendar: made again below.
    if (await call(ctx, 'PATCH', `${events(calendar)}/${encodeURIComponent(live.remoteId)}`, body, [404, 410])) {
      await ctx.links.set(type, o.id, live.remoteId, { calendar, hash });
      return 'updated';
    }
  } else if (live) {
    // The location now uses another calendar: the event moves there.
    await call(ctx, 'DELETE', `${events(String(live.extra.calendar))}/${encodeURIComponent(live.remoteId)}`, undefined, [404, 410]);
  }
  const created = await call(ctx, 'POST', events(calendar), body);
  if (!created?.id) throw new Error('Google Calendar did not return an event');
  await ctx.links.set(type, o.id, created.id, { calendar, hash, url: created.htmlLink ?? null });
  return live ? 'updated' : 'created';
}

/** Both events of a booking; a summary for the sync log. */
export async function syncOrder(ctx: IntegrationContext, orderId: string): Promise<IntegrationResult> {
  const o = await ctx.data.order(orderId);
  if (!o) return { status: 'skipped', message: 'Order not found' };
  const wanted = BOOKED.includes(o.status);
  const done = [];
  for (const m of MOMENTS) done.push(await sync(ctx, o, m, wanted));
  const changed = done.filter((d) => d !== 'none' && d !== 'same');
  if (!changed.length) return { status: 'skipped', message: wanted ? `Events for #${o.number} unchanged` : `#${o.number} is not booked` };
  const word = changed.includes('removed') ? 'removed' : changed.includes('created') ? 'created' : 'updated';
  return { status: 'done', message: `Pickup and return of #${o.number} ${word}` };
}

export function googleCalendarIntegration(): IntegrationProvider {
  return {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'calendar',
    auth: {
      type: 'oauth2', authorizeUrl: AUTHORIZE, tokenUrl: TOKEN, clientAuth: 'body', baseUrlSetting: 'oauth_base_url',
      scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
      // A refresh token only comes with offline access, and again only when consent is asked for.
      authorizeParams: { access_type: 'offline', prompt: 'consent' },
      clientIdSetting: 'client_id', clientSecretSetting: 'client_secret',
    },
    events: ['order.created', 'order.updated', 'order.status_changed', 'order.extension_decided'],
    settings: [
      { key: 'calendar_id', label: 'Calendar', type: 'text', help: 'Calendar id from its Google settings; empty for your main calendar' },
      { key: 'location_calendars', label: 'Calendar per location', type: 'text', help: 'Optional, e.g. "Tallinn = abc@group.calendar.google.com; Tartu = def@group.calendar.google.com"' },
      { key: 'event_minutes', label: 'Event length in minutes', type: 'number', help: 'Default 30' },
      { key: 'pickup_title', label: 'Pickup title', type: 'text', help: 'Default "Pickup #{number} · {customer}"; {location} also works' },
      { key: 'return_title', label: 'Return title', type: 'text', help: 'Default "Return #{number} · {customer}"' },
    ],
    async onConnected(ctx) {
      const cal = await call(ctx, 'GET', '/calendar/v3/calendars/primary');
      if (!cal?.id) throw new Error('No Google calendar was shared');
      return { accountName: cal.summary ?? cal.id, account: { calendar: cal.id, time_zone: cal.timeZone ?? null } };
    },
    async handle(ctx, task) {
      if (task.object.type !== 'order') return { status: 'skipped', message: `Nothing to do for ${task.event}` };
      return syncOrder(ctx, task.object.id);
    },
  };
}

export default definePlugin({
  id: 'calendar-google',
  name: 'Google Calendar',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.4.0',
  permissions: ['integrations', 'network', 'orders:read', 'customers:read'],
  settings: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true, help: 'An OAuth client of type "Web application" in Google Cloud, with the redirect URL shown on the Integrations page' },
    { key: 'client_secret', label: 'Client secret', type: 'secret', required: true },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
    { key: 'oauth_base_url', label: 'Sign-in base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ client_id: api.env('GOOGLE_CLIENT_ID'), client_secret: api.env('GOOGLE_CLIENT_SECRET') });
    api.registerIntegration(googleCalendarIntegration());
  },
});
