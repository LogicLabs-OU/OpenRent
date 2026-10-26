import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGoogleCalendarFake, type GoogleCalendarFake } from '@openrent/calendar-fakes';
import { publishOutbox, runIntegrationTasks } from '../../worker/src/jobs.ts';
import { Client, databaseForTests, isoIn, quietLogger, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/**
 * Calendar push (FR-INT-4) end to end: the real Google Calendar plugin against its fake, through the
 * API (app credentials, OAuth, settings) and the worker (events become tasks, tasks become calendar
 * events that follow the booking).
 */
suite('calendar push with Google Calendar', () => {
  let t: TestApp;
  let admin: Client;
  let fake: GoogleCalendarFake;
  let variant: string;
  let connectionId: string;
  const work = async () => {
    await publishOutbox(t.deps, quietLogger);
    return runIntegrationTasks(t.deps, quietLogger);
  };
  const ours = (orderId: string, cal?: string) => fake.events(cal).filter((e) => e.extendedProperties?.private?.openrent_order === orderId);

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    fake = await startGoogleCalendarFake({ calendars: ['branch@group.calendar.google.com'] });
    variant = (await admin.post('/api/v1/products', { type: 'rental', name: 'Canoe', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } })).body.variants[0].id;
  }, 120_000);

  afterAll(async () => {
    await fake?.close();
    await t?.close();
    await dbinfo?.stop();
  });

  it('connects with OAuth once the app credentials are set', async () => {
    const before = (await admin.get('/api/v1/integrations')).body.data.find((i: any) => i.id === 'google-calendar');
    expect(before).toMatchObject({ category: 'calendar', auth: 'oauth2', ready: false });
    const cfg = await admin.patch('/api/v1/plugins/calendar-google', { enabled: true, config: { client_id: 'google-client', client_secret: 'google-secret', api_base_url: fake.url, oauth_base_url: fake.url } });
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(200);
    const start = await admin.post('/api/v1/integrations/google-calendar/connect', {});
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const url = new URL(start.body.authorize_url);
    expect([url.pathname, url.searchParams.get('access_type'), url.searchParams.get('prompt')]).toEqual(['/o/oauth2/v2/auth', 'offline', 'consent']);
    const auth = await fetch(start.body.authorize_url, { redirect: 'manual' });
    const back = new URL(auth.headers.get('location')!);
    const done = await new Client(t.app).get(`${back.pathname}${back.search}`);
    expect(done.headers.location).toBe('http://localhost:7070/admin/integrations?connected=google-calendar');
    const conn = (await admin.get('/api/v1/integrations')).body.data.find((i: any) => i.id === 'google-calendar').connection;
    expect(conn).toMatchObject({ status: 'connected', account_name: 'shop@example.com' });
    connectionId = conn.id;
  });

  it('puts a reserved booking on the calendar, follows its dates and takes it off when cancelled', async () => {
    const c = (await admin.post('/api/v1/customers', { name: 'Cal Customer', email: 'cal@test.dev' })).body;
    const o = (await admin.post('/api/v1/orders', { customer_id: c.id, starts_at: isoIn(5), ends_at: isoIn(7), lines: [{ variant_id: variant, quantity: 1 }] })).body;
    await work();
    expect(o.status).toBe('draft');
    // A draft holds no dates yet.
    expect(ours(o.id)).toEqual([]);
    await admin.post(`/api/v1/orders/${o.id}/actions/reserve`, { notify: false });
    await work();
    const events = ours(o.id).sort((a, b) => a.start.dateTime!.localeCompare(b.start.dateTime!));
    expect(events.map((e) => [e.summary, e.start.dateTime])).toEqual([
      [`Pickup #${o.number} · Cal Customer`, new Date(o.starts_at).toISOString()],
      [`Return #${o.number} · Cal Customer`, new Date(o.ends_at).toISOString()],
    ]);
    const tasks = (await admin.get(`/api/v1/integration_connections/${connectionId}/tasks`)).body.data;
    expect(tasks.some((x: any) => x.status === 'done' && x.message === `Pickup and return of #${o.number} created`)).toBe(true);

    // The shop puts this location on its own calendar: the events move there.
    const loc = (await admin.get('/api/v1/locations')).body.data[0];
    await admin.patch(`/api/v1/integration_connections/${connectionId}`, { settings: { location_calendars: `${loc.name} = branch@group.calendar.google.com`, event_minutes: 60 } });
    const upd = await admin.patch(`/api/v1/orders/${o.id}`, { tags: ['paddles'] });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    await work();
    expect(ours(o.id)).toEqual([]);
    expect(ours(o.id, 'branch@group.calendar.google.com').map((e) => Date.parse(e.end.dateTime!) - Date.parse(e.start.dateTime!))).toEqual([3_600_000, 3_600_000]);

    await admin.post(`/api/v1/orders/${o.id}/actions/cancel`, { reason: 'Changed plans', notify: false });
    await work();
    expect(ours(o.id, 'branch@group.calendar.google.com')).toEqual([]);
  });
});
