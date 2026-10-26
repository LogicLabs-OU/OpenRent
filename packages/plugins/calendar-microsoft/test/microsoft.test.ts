import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IntegrationOrder } from '@openrent/plugin-sdk';
import { memoryContext } from '@openrent/accounting-fakes';
import { startGraphCalendarFake, type GraphCalendarFake } from '@openrent/calendar-fakes';
import { eventFor, microsoftCalendarIntegration } from '../src/index.ts';

const contact = { id: 'cus_1', name: 'Grace Hopper', company_name: 'Navy Hire', email: 'grace@example.org', phone: null, tax_id: null, address: null };
const booking = (over: Partial<IntegrationOrder> = {}): IntegrationOrder => ({
  id: 'ord_1', number: 77, status: 'reserved', source: 'admin', currency: 'EUR', total: 5000, balance: 5000,
  starts_at: '2026-11-02T09:00:00.000Z', ends_at: '2026-11-03T09:00:00.000Z', created_at: '2026-10-26T10:00:00.000Z',
  contact, location: { id: 'loc_1', name: 'Tallinn' }, lines: [{ description: 'Projector', quantity: 1, total: 5000, product_id: 'prd_1' }], ...over,
});
const task = (id = 'ord_1') => ({ id: 'tsk', event: 'order.updated', object: { type: 'order', id }, attempt: 1 });

describe('Microsoft 365 calendar integration', () => {
  let fake: GraphCalendarFake;
  beforeAll(async () => {
    fake = await startGraphCalendarFake();
  });
  afterAll(() => fake.close());

  it('sends wall-clock UTC times, as Graph wants them', () => {
    expect(eventFor(booking(), 'pickup', { event_minutes: 45 })).toMatchObject({
      subject: 'Pickup #77 · Navy Hire', start: { dateTime: '2026-11-02T09:00:00.000', timeZone: 'UTC' }, end: { dateTime: '2026-11-02T09:45:00.000', timeZone: 'UTC' },
      body: { contentType: 'text', content: '1 × Projector\nGrace Hopper · grace@example.org' }, location: { displayName: 'Tallinn' },
    });
  });

  it('checks the connection and lists the mailbox calendars', async () => {
    const { ctx } = memoryContext(fake);
    const r = await microsoftCalendarIntegration().onConnected!(ctx, {});
    expect(r).toEqual({ accountName: 'shop@example.com', account: { user: 'shop@example.com', calendars: [{ id: 'cal-default', name: 'Calendar' }, { id: 'cal-tartu', name: 'Tartu branch' }] } });
  });

  it('creates both events on the default calendar, updates and removes them', async () => {
    const order = booking();
    const { ctx, links } = memoryContext(fake, { data: { orders: [order] } });
    const m = microsoftCalendarIntegration();
    expect(await m.handle(ctx, task())).toEqual({ status: 'done', message: 'Pickup and return of #77 created' });
    expect(fake.events('cal-default').map((e) => e.subject).sort()).toEqual(['Pickup #77 · Navy Hire', 'Return #77 · Navy Hire']);
    expect(await m.handle(ctx, task())).toEqual({ status: 'skipped', message: 'Events for #77 unchanged' });
    order.starts_at = '2026-11-02T08:00:00.000Z';
    const before = fake.calls.length;
    expect((await m.handle(ctx, task())).message).toBe('Pickup and return of #77 updated');
    expect(fake.calls.slice(before).map((c) => `${c.method} ${c.path.replace(/AAMk\w+/, '{id}')}`)).toEqual(['PATCH /v1.0/me/events/{id}']);
    // Deleted in Outlook, then the booking changes again: the event comes back.
    fake.deleteInOutlook(links.get('order_return:ord_1')!.remoteId);
    order.ends_at = '2026-11-04T09:00:00.000Z';
    await m.handle(ctx, task());
    expect(fake.events().find((e) => e.subject === 'Return #77 · Navy Hire')!.start.dateTime).toBe('2026-11-04T09:00:00.000');
    order.status = 'expired';
    expect((await m.handle(ctx, task())).message).toBe('Pickup and return of #77 removed');
    expect(fake.events().filter((e) => e.subject?.includes('#77'))).toEqual([]);
  });

  it('puts a location on its own calendar', async () => {
    const order = booking({ id: 'ord_2', number: 78, location: { id: 'loc_2', name: 'Tartu' } });
    const { ctx } = memoryContext(fake, { settings: { location_calendars: 'Tartu = cal-tartu' }, data: { orders: [order] } });
    await microsoftCalendarIntegration().handle(ctx, task('ord_2'));
    expect(fake.events('cal-tartu').map((e) => e.subject).sort()).toEqual(['Pickup #78 · Navy Hire', 'Return #78 · Navy Hire']);
  });

  it('waits when Graph throttles', async () => {
    const { ctx } = memoryContext(fake, { data: { orders: [booking({ id: 'ord_3' })] } });
    fake.rateLimit(1, 3);
    await expect(microsoftCalendarIntegration().handle(ctx, task('ord_3'))).rejects.toMatchObject({ name: 'RetryLater', retryAfterMs: 3000 });
  });
});
