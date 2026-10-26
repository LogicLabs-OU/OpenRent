import { definePlugin, RetryLater, type IntegrationContext, type IntegrationOrder, type IntegrationProvider, type IntegrationResult } from '@openrent/plugin-sdk';

/**
 * Microsoft 365 and Outlook calendars through Microsoft Graph (FR-INT-4): each booking's pickup and
 * return become events on the signed-in mailbox's calendar, or on one calendar per location. They move
 * when the dates change and go when the booking is cancelled; unchanged bookings cost no calls.
 */
const AUTHORIZE = 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize';
const TOKEN = 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token';
const API = 'https://graph.microsoft.com';
/** Bookings that hold their dates have events; drafts, quotes and cancelled ones have none. */
export const BOOKED = ['reserved', 'prepared', 'out', 'returned_partial', 'returned', 'closed'];
const MOMENTS = ['pickup', 'return'] as const;
export type Moment = (typeof MOMENTS)[number];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The calendar id for a booking's location: `location_calendars` ("Tallinn = id; Tartu = id"), the main one, or null for the default calendar. */
export function calendarFor(location: { id: string; name: string }, settings: Record<string, unknown>) {
  for (const pair of String(settings.location_calendars ?? '').split(/[\n;]+/)) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const key = pair.slice(0, at).trim().toLowerCase();
    const cal = pair.slice(at + 1).trim();
    if (cal && (key === location.id.toLowerCase() || key === location.name.trim().toLowerCase())) return cal;
  }
  return str(settings.calendar_id);
}

/** `{number}`, `{customer}` and `{location}` filled in; a missing customer drops its separator. */
export function title(template: string, o: IntegrationOrder) {
  const customer = o.contact?.company_name || o.contact?.name || '';
  return template.replace(/\{number\}/g, String(o.number)).replace(/\{location\}/g, o.location.name).replace(/\s*[·\-|]?\s*\{customer\}/g, customer ? ` · ${customer}` : '').trim();
}

/** Graph wants a wall-clock time with its zone named apart; OpenRent sends UTC. */
const graphTime = (ms: number) => ({ dateTime: new Date(ms).toISOString().slice(0, 23), timeZone: 'UTC' });

export function eventFor(o: IntegrationOrder, moment: Moment, settings: Record<string, unknown>) {
  const at = Date.parse(moment === 'pickup' ? o.starts_at : o.ends_at);
  const minutes = Math.min(1440, Math.max(5, Number(settings.event_minutes) || 30));
  const template = moment === 'pickup' ? (str(settings.pickup_title) ?? 'Pickup #{number} · {customer}') : (str(settings.return_title) ?? 'Return #{number} · {customer}');
  const contact = o.contact ? [o.contact.name, o.contact.phone, o.contact.email].filter(Boolean).join(' · ') : '';
  return {
    subject: title(template, o),
    body: { contentType: 'text', content: [...o.lines.map((l) => `${l.quantity} × ${l.description}`), contact].filter(Boolean).join('\n').slice(0, 8000) },
    location: { displayName: o.location.name },
    start: graphTime(at),
    end: graphTime(at + minutes * 60_000),
    // Staff are at the counter anyway: no pop-up reminders.
    isReminderOn: false,
    showAs: 'free',
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
  if (res.status === 429 || res.status === 503) throw new RetryLater('Microsoft Graph asked to wait', Number(res.headers?.get('retry-after') ?? 30) * 1000);
  if (!res.ok) throw new Error(`Microsoft Graph: ${data?.error?.message ?? `HTTP ${res.status}`}`);
  return data;
}

const eventPath = (id: string) => `/v1.0/me/events/${encodeURIComponent(id)}`;

/** Brings one of the booking's events in line; returns what was done. */
async function sync(ctx: IntegrationContext, o: IntegrationOrder, moment: Moment, wanted: boolean) {
  const type = `order_${moment}`;
  const link = await ctx.links.get(type, o.id);
  const live = link && !link.extra.deleted && link.remoteId ? link : null;
  if (!wanted) {
    if (!live) return 'none';
    await call(ctx, 'DELETE', eventPath(live.remoteId), undefined, [404]);
    await ctx.links.set(type, o.id, live.remoteId, { deleted: true });
    return 'removed';
  }
  const calendar = calendarFor(o.location, ctx.connection.settings);
  const body = eventFor(o, moment, ctx.connection.settings);
  const hash = digest(JSON.stringify(body));
  if (live && (live.extra.calendar ?? null) === calendar) {
    if (live.extra.hash === hash) return 'same';
    // Deleted by hand in Outlook: made again below.
    if (await call(ctx, 'PATCH', eventPath(live.remoteId), body, [404])) {
      await ctx.links.set(type, o.id, live.remoteId, { calendar, hash });
      return 'updated';
    }
  } else if (live) {
    // The location now uses another calendar: the event moves there.
    await call(ctx, 'DELETE', eventPath(live.remoteId), undefined, [404]);
  }
  const created = await call(ctx, 'POST', calendar ? `/v1.0/me/calendars/${encodeURIComponent(calendar)}/events` : '/v1.0/me/events', body);
  if (!created?.id) throw new Error('Microsoft Graph did not return an event');
  await ctx.links.set(type, o.id, created.id, { calendar, hash, url: created.webLink ?? null });
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

export function microsoftCalendarIntegration(): IntegrationProvider {
  return {
    id: 'microsoft-calendar',
    name: 'Microsoft 365 Calendar',
    category: 'calendar',
    auth: {
      type: 'oauth2', authorizeUrl: AUTHORIZE, tokenUrl: TOKEN, clientAuth: 'body', baseUrlSetting: 'oauth_base_url',
      scopes: ['offline_access', 'User.Read', 'Calendars.ReadWrite'],
      clientIdSetting: 'client_id', clientSecretSetting: 'client_secret',
    },
    events: ['order.created', 'order.updated', 'order.status_changed', 'order.extension_decided'],
    settings: [
      { key: 'calendar_id', label: 'Calendar', type: 'text', help: 'Calendar id from Microsoft Graph; empty for the default calendar' },
      { key: 'location_calendars', label: 'Calendar per location', type: 'text', help: 'Optional, e.g. "Tallinn = AAMkAD…; Tartu = AAMkAE…"' },
      { key: 'event_minutes', label: 'Event length in minutes', type: 'number', help: 'Default 30' },
      { key: 'pickup_title', label: 'Pickup title', type: 'text', help: 'Default "Pickup #{number} · {customer}"; {location} also works' },
      { key: 'return_title', label: 'Return title', type: 'text', help: 'Default "Return #{number} · {customer}"' },
    ],
    async onConnected(ctx) {
      const me = await call(ctx, 'GET', '/v1.0/me');
      if (!me?.id) throw new Error('No Microsoft account was shared');
      const cals = (await call(ctx, 'GET', '/v1.0/me/calendars'))?.value ?? [];
      return { accountName: me.mail ?? me.userPrincipalName ?? me.displayName, account: { user: me.mail ?? me.userPrincipalName ?? null, calendars: cals.map((c: any) => ({ id: c.id, name: c.name })) } };
    },
    async handle(ctx, task) {
      if (task.object.type !== 'order') return { status: 'skipped', message: `Nothing to do for ${task.event}` };
      return syncOrder(ctx, task.object.id);
    },
  };
}

export default definePlugin({
  id: 'calendar-microsoft',
  name: 'Microsoft 365 Calendar',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.4.0',
  permissions: ['integrations', 'network', 'orders:read', 'customers:read'],
  settings: [
    { key: 'client_id', label: 'Application (client) ID', type: 'text', required: true, help: 'An app registration in Microsoft Entra ID, with the redirect URL shown on the Integrations page' },
    { key: 'client_secret', label: 'Client secret', type: 'secret', required: true },
    { key: 'tenant', label: 'Directory (tenant)', type: 'text', help: '"common" for any account (default), "organizations", or your tenant id' },
    { key: 'api_base_url', label: 'API base URL (testing only)', type: 'text' },
    { key: 'oauth_base_url', label: 'Sign-in base URL (testing only)', type: 'text' },
  ],
  setup(api) {
    api.setDefaultConfig({ client_id: api.env('MICROSOFT_CLIENT_ID'), client_secret: api.env('MICROSOFT_CLIENT_SECRET'), tenant: api.env('MICROSOFT_TENANT') ?? 'common' });
    api.registerIntegration(microsoftCalendarIntegration());
  },
});
