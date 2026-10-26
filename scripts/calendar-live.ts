/**
 * Live check of the Google Calendar and Microsoft 365 calendar plugins against the real APIs. Opt-in: a
 * calendar is checked only when its token is set. Each check puts a made-up booking two days ahead on
 * the calendar (pickup and return), moves the return by an hour, and cancels the booking, which
 * deletes both events again.
 *
 *   GOOGLE_ACCESS_TOKEN=ya29...  [GOOGLE_CALENDAR_ID=...]         (calendar.events scope, e.g. from the OAuth Playground)
 *   MICROSOFT_ACCESS_TOKEN=eyJ... [MICROSOFT_CALENDAR_ID=...]     (Calendars.ReadWrite, e.g. from Graph Explorer)
 *
 *   pnpm test:calendar-live
 */
import type { IntegrationContext, IntegrationOrder } from '@openrent/plugin-sdk';
import { syncOrder as syncGoogle } from '@openrent/plugin-calendar-google';
import { syncOrder as syncMicrosoft } from '@openrent/plugin-calendar-microsoft';

const env = (k: string) => process.env[k]?.trim() ?? '';
const start = new Date(Date.now() + 2 * 86400_000);
start.setUTCMinutes(0, 0, 0);
const order: IntegrationOrder = {
  id: 'ord_live_check', number: 9999, status: 'reserved', source: 'admin', currency: 'EUR', total: 100, balance: 0,
  starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), created_at: new Date().toISOString(),
  contact: { id: 'cus_live', name: 'OpenRent live check', company_name: null, email: null, phone: null, tax_id: null, address: null },
  location: { id: 'loc_live', name: 'Live check' }, lines: [{ description: 'Test item', quantity: 1, total: 100, product_id: null }],
};

function context(token: string, settings: Record<string, unknown>): IntegrationContext {
  const links = new Map<string, { remoteId: string; extra: Record<string, unknown> }>();
  return {
    tenantId: 'live-check', config: {}, logger: { info() {}, warn() {}, error: console.error, debug() {} }, credentials: {},
    connection: { id: 'icn_live', settings, account: {} },
    fetch: (url, init = {}) => fetch(url, { method: init.method ?? 'GET', body: init.body as BodyInit | undefined, headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } }),
    links: { get: async (t, id) => links.get(`${t}:${id}`) ?? null, set: async (t, id, remoteId, extra = {}) => void links.set(`${t}:${id}`, { remoteId, extra }) },
    data: {
      accounting: { contact: async () => null, invoice: async () => null, payment: async () => null, entry: async () => null, documentPdf: async () => null },
      contact: async () => order.contact,
      order: async () => ({ ...order }),
    },
  };
}

const checks = [
  { name: 'Google Calendar', token: 'GOOGLE_ACCESS_TOKEN', settings: { calendar_id: env('GOOGLE_CALENDAR_ID') }, sync: syncGoogle },
  { name: 'Microsoft 365', token: 'MICROSOFT_ACCESS_TOKEN', settings: { calendar_id: env('MICROSOFT_CALENDAR_ID') }, sync: syncMicrosoft },
];

let ran = 0;
let failed = 0;
for (const c of checks) {
  if (!env(c.token)) {
    console.log(`${c.name}: skipped (set ${c.token})`);
    continue;
  }
  ran++;
  console.log(`${c.name}:`);
  const ctx = context(env(c.token), c.settings);
  const saved = { ...order };
  try {
    console.log(`  ${(await c.sync(ctx, order.id)).message}`);
    order.ends_at = new Date(Date.parse(order.ends_at) + 3600_000).toISOString();
    console.log(`  ${(await c.sync(ctx, order.id)).message}`);
    order.status = 'cancelled';
    console.log(`  ${(await c.sync(ctx, order.id)).message}`);
    console.log('  ok');
  } catch (e) {
    failed++;
    console.log(`  FAILED: ${(e as Error).message}`);
  } finally {
    Object.assign(order, saved);
  }
}
if (!ran) console.log('Nothing to check: no tokens set.');
process.exit(failed ? 1 : 0);
