import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IntegrationOrder } from '@openrent/plugin-sdk';
import { memoryContext } from '@openrent/accounting-fakes';
import { startGoogleCalendarFake, type GoogleCalendarFake } from '@openrent/calendar-fakes';
import { calendarFor, googleCalendarIntegration, title } from '../src/index.ts';

const contact = { id: 'cus_1', name: 'Ada Lovelace', company_name: null, email: 'ada@example.org', phone: '+372 555', tax_id: null, address: null };
const booking = (over: Partial<IntegrationOrder> = {}): IntegrationOrder => ({
  id: 'ord_1', number: 1042, status: 'reserved', source: 'storefront', currency: 'EUR', total: 9300, balance: 0,
  starts_at: '2026-11-02T09:00:00.000Z', ends_at: '2026-11-05T17:00:00.000Z', created_at: '2026-10-26T10:00:00.000Z',
  contact, location: { id: 'loc_1', name: 'Tallinn' }, lines: [{ description: 'Kayak', quantity: 2, total: 9300, product_id: 'prd_1' }], ...over,
});
const task = (event = 'order.updated') => ({ id: 'tsk', event, object: { type: 'order', id: 'ord_1' }, attempt: 1 });

describe('Google Calendar integration', () => {
  let fake: GoogleCalendarFake;
  beforeAll(async () => {
    fake = await startGoogleCalendarFake({ calendars: ['tartu@group.calendar.google.com'] });
  });
  afterAll(() => fake.close());

  it('picks the calendar for the location and fills in titles', () => {
    const s = { calendar_id: 'main@group', location_calendars: 'Tartu = tartu@group; loc_9=nine@group' };
    expect(calendarFor({ id: 'loc_1', name: 'Tallinn' }, s)).toBe('main@group');
    expect(calendarFor({ id: 'loc_2', name: 'tartu' }, s)).toBe('tartu@group');
    expect(calendarFor({ id: 'loc_9', name: 'Pärnu' }, s)).toBe('nine@group');
    expect(calendarFor({ id: 'loc_1', name: 'Tallinn' }, {})).toBe('primary');
    expect(title('Pickup #{number} · {customer}', booking())).toBe('Pickup #1042 · Ada Lovelace');
    expect(title('Pickup #{number} · {customer}', booking({ contact: null }))).toBe('Pickup #1042');
    expect(title('Abholung {location} #{number}', booking())).toBe('Abholung Tallinn #1042');
  });

  it('checks the connection and keeps the calendar it signed in to', async () => {
    const { ctx } = memoryContext(fake);
    expect(await googleCalendarIntegration().onConnected!(ctx, {})).toEqual({ accountName: 'shop@example.com', account: { calendar: 'shop@example.com', time_zone: 'UTC' } });
  });

  it('creates a pickup and a return event, skips unchanged bookings and moves events with the dates', async () => {
    const order = booking();
    const { ctx, links } = memoryContext(fake, { data: { orders: [order] } });
    const g = googleCalendarIntegration();
    expect(await g.handle(ctx, task('order.created'))).toEqual({ status: 'done', message: 'Pickup and return of #1042 created' });
    const [pickup, ret] = fake.events().sort((a, b) => a.start.dateTime!.localeCompare(b.start.dateTime!));
    expect(pickup).toMatchObject({ summary: 'Pickup #1042 · Ada Lovelace', location: 'Tallinn', start: { dateTime: '2026-11-02T09:00:00.000Z' }, end: { dateTime: '2026-11-02T09:30:00.000Z' } });
    expect(pickup!.description).toBe('2 × Kayak\nAda Lovelace · +372 555 · ada@example.org');
    expect(ret).toMatchObject({ summary: 'Return #1042 · Ada Lovelace', start: { dateTime: '2026-11-05T17:00:00.000Z' }, extendedProperties: { private: { openrent_order: 'ord_1', openrent_moment: 'return' } } });
    expect(links.get('order_pickup:ord_1')).toMatchObject({ remoteId: pickup!.id, extra: { calendar: 'primary' } });

    // Paid, notes changed…: nothing new for the calendar, no calls.
    const before = fake.calls.length;
    expect(await g.handle(ctx, task())).toEqual({ status: 'skipped', message: 'Events for #1042 unchanged' });
    expect(fake.calls.length).toBe(before);

    // Extended by a day: only the return moves.
    order.ends_at = '2026-11-06T17:00:00.000Z';
    expect(await g.handle(ctx, task('order.extension_decided'))).toEqual({ status: 'done', message: 'Pickup and return of #1042 updated' });
    expect(fake.calls.slice(before).map((c) => c.method)).toEqual(['PATCH']);
    expect(fake.events().find((e) => e.id === ret!.id)!.start.dateTime).toBe('2026-11-06T17:00:00.000Z');
  });

  it('makes an event again when someone deleted it in Google, and moves events to the location calendar', async () => {
    const order = booking({ id: 'ord_2', number: 1043 });
    const { ctx, links } = memoryContext(fake, { data: { orders: [order] } });
    const g = googleCalendarIntegration();
    const run = () => g.handle(ctx, { ...task(), object: { type: 'order', id: 'ord_2' } });
    await run();
    const first = links.get('order_pickup:ord_2')!.remoteId;
    fake.deleteInGoogle('shop@example.com', first);
    order.starts_at = '2026-11-02T10:00:00.000Z';
    await run();
    const again = links.get('order_pickup:ord_2')!.remoteId;
    expect(again).not.toBe(first);
    expect(fake.events().find((e) => e.id === again)!.start.dateTime).toBe('2026-11-02T10:00:00.000Z');

    ctx.connection.settings = { location_calendars: 'Tallinn = tartu@group.calendar.google.com' };
    await run();
    expect(fake.events('tartu@group.calendar.google.com').map((e) => e.summary).sort()).toEqual(['Pickup #1043 · Ada Lovelace', 'Return #1043 · Ada Lovelace']);
    expect(fake.events().filter((e) => e.extendedProperties?.private?.openrent_order === 'ord_2')).toEqual([]);
  });

  it('removes both events when the booking is cancelled, and leaves quotes alone', async () => {
    const order = booking({ id: 'ord_3', number: 1044 });
    const { ctx, links } = memoryContext(fake, { data: { orders: [order] } });
    const g = googleCalendarIntegration();
    const run = () => g.handle(ctx, { ...task(), object: { type: 'order', id: 'ord_3' } });
    await run();
    order.status = 'cancelled';
    expect(await run()).toEqual({ status: 'done', message: 'Pickup and return of #1044 removed' });
    expect(fake.events().filter((e) => e.extendedProperties?.private?.openrent_order === 'ord_3')).toEqual([]);
    expect(links.get('order_return:ord_3')!.extra).toEqual({ deleted: true });
    expect(await run()).toEqual({ status: 'skipped', message: '#1044 is not booked' });
    // Booked again later: new events.
    order.status = 'reserved';
    expect((await run()).message).toBe('Pickup and return of #1044 created');
  });

  it('waits when Google rate limits, and refuses an empty time range', async () => {
    const { ctx } = memoryContext(fake, { data: { orders: [booking({ id: 'ord_4' })] } });
    fake.rateLimit(1, 7);
    await expect(googleCalendarIntegration().handle(ctx, { ...task(), object: { type: 'order', id: 'ord_4' } })).rejects.toMatchObject({ name: 'RetryLater', retryAfterMs: 7000 });
    const { ctx: c2 } = memoryContext(fake, { settings: { event_minutes: -5 }, data: { orders: [booking({ id: 'ord_5' })] } });
    // A silly length is clamped to 5 minutes rather than sent as an empty range.
    expect((await googleCalendarIntegration().handle(c2, { ...task(), object: { type: 'order', id: 'ord_5' } })).status).toBe('done');
  });
});
