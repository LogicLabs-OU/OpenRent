import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Maintenance tickets v2 (FR-MNT-2): several units, priority, assignee, due date, cost, parts, resolution. */
suite('maintenance tickets', () => {
  let t: TestApp;
  let admin: Client;
  let mechanic: Client;
  let mechanicId: string;
  let locationId: string;
  const units: Record<string, string> = {};

  const unit = async (barcode: string) => (await admin.get(`/api/v1/stock_items/${units[barcode]}`)).body;
  const free = async (variant: string) =>
    (await admin.get(`/api/v1/availability?variant_id=${variant}&from=${encodeURIComponent(isoIn(1))}&to=${encodeURIComponent(isoIn(2))}`)).body.available;
  let bike: string;

  beforeAll(async () => {
    ({ t, admin, locationId } = await shopForTests(dbinfo!));
    const u = await admin.post('/api/v1/users', { email: 'mechanic@test.dev', name: 'Mia Mechanic', role: 'staff', password: 'password123' });
    expect(u.status, JSON.stringify(u.body)).toBe(201);
    mechanicId = u.body.user_id ?? u.body.id;
    mechanic = new Client(t.app);
    expect((await mechanic.post('/api/v1/auth/login', { email: 'mechanic@test.dev', password: 'password123' })).status).toBe(200);
    bike = (await admin.post('/api/v1/products', { type: 'rental', name: 'E-bike', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } })).body.variants[0].id;
    for (const b of ['BK-1', 'BK-2', 'BK-3']) units[b] = (await admin.post('/api/v1/stock_items', { variant_id: bike, location_id: locationId, barcode: b })).body.id;
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('refuses incomplete tickets field by field', async () => {
    const r = await admin.post('/api/v1/maintenance_tickets', { stock_item_ids: [], assignee_id: 'usr_nobody', cost: 10, parts: [{ name: ' ', quantity: 0, unit_cost: 5 }] });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: any) => e.field).sort()).toEqual(['assignee_id', 'parts[0].name', 'parts[0].quantity', 'stock_item_ids']);
  });

  it('takes several units out of service on one ticket and tells the assignee', async () => {
    const r = await admin.post('/api/v1/maintenance_tickets', {
      stock_item_ids: [units['BK-1'], units['BK-2']], title: 'Brakes squeal', priority: 'high', assignee_id: mechanicId, due_at: isoIn(-1), severity: 'hard_down',
      parts: [{ name: 'Brake pads', quantity: 2, unit_cost: 1250 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    units.ticket = r.body.id;
    expect(r.body).toMatchObject({ status: 'open', priority: 'high', title: 'Brakes squeal', overdue: true, assignee: { id: mechanicId, name: 'Mia Mechanic' } });
    expect(r.body.units.map((u: any) => u.barcode)).toEqual(['BK-1', 'BK-2']);
    expect([r.body.parts_cost.amount, r.body.total_cost.amount]).toEqual([2500, 2500]);
    expect((await unit('BK-1')).status).toBe('hard_down');
    expect((await unit('BK-2')).status).toBe('hard_down');
    expect(await free(bike)).toBe(1);
    // One ticket, not one per unit; the second unit cannot be on another open ticket.
    expect((await admin.get('/api/v1/maintenance_tickets')).body.data).toHaveLength(1);
    const again = await admin.post('/api/v1/maintenance_tickets', { stock_item_ids: [units['BK-2']] });
    expect([again.status, again.body.errors[0].field]).toEqual([422, 'stock_item_ids[0]']);
    // The mechanic's notice and "my tickets".
    const notes = (await mechanic.get('/api/v1/me/notifications')).body.data;
    expect(notes.map((n: any) => [n.kind, n.params.title, n.entity_type])).toEqual([['staff_ticket_assigned', 'Brakes squeal', 'maintenance_ticket']]);
    expect((await mechanic.get('/api/v1/maintenance_tickets?assignee_id=me')).body.data.map((x: any) => x.id)).toEqual([r.body.id]);
    expect((await admin.get('/api/v1/maintenance_tickets?assignee_id=me')).body.data).toEqual([]);
    expect((await admin.get('/api/v1/maintenance_tickets?overdue=true&priority=high')).body.data).toHaveLength(1);
  });

  it('records the work, then resolves the ticket and puts every unit back into service', async () => {
    const id = units.ticket;
    const started = (await mechanic.post(`/api/v1/maintenance_tickets/${id}/actions/start`, {})).body;
    expect(started.status).toBe('in_progress');
    expect(started.started_at).toBeTruthy();
    const edited = await mechanic.patch(`/api/v1/maintenance_tickets/${id}`, { cost: 4000, due_at: isoIn(2), priority: 'urgent' });
    expect(edited.body).toMatchObject({ overdue: false, priority: 'urgent', total_cost: { amount: 6500 } });
    const bad = await mechanic.post(`/api/v1/maintenance_tickets/${id}/actions/resolve`, { parts: [{ name: 'Cable', quantity: 1, unit_cost: -1 }] });
    expect(bad.status).toBe(400);
    const done = await mechanic.post(`/api/v1/maintenance_tickets/${id}/actions/resolve`, { resolution: 'Replaced pads on both bikes', parts: [{ name: 'Brake pads', quantity: 4, unit_cost: 1250 }] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'done', resolution: 'Replaced pads on both bikes', total_cost: { amount: 9000 } });
    expect((await unit('BK-1')).status).toBe('available');
    expect((await unit('BK-2')).status).toBe('available');
    expect(await free(bike)).toBe(3);
    expect((await admin.patch(`/api/v1/maintenance_tickets/${id}`, { notes: 'late' })).body.code).toBe('ticket_closed');
    // Both units can get new tickets now.
    const next = await admin.post('/api/v1/maintenance_tickets', { stock_item_ids: [units['BK-2']], title: 'Flat tyre' });
    expect(next.status).toBe(201);
    units.next = next.body.id;
  });

  it('cancels a ticket opened by mistake and the unit goes back into service', async () => {
    const r = await admin.post(`/api/v1/maintenance_tickets/${units.next}/actions/cancel`, { reason: 'Tyre was fine' });
    expect(r.body).toMatchObject({ status: 'cancelled', resolution: 'Tyre was fine' });
    expect((await unit('BK-2')).status).toBe('available');
    expect((await admin.get('/api/v1/maintenance_tickets?status=cancelled')).body.data.map((x: any) => x.id)).toEqual([units.next]);
  });

  it('keeps the old close action and the automatic ticket of a unit taken out of service', async () => {
    await admin.post(`/api/v1/stock_items/${units['BK-3']}/actions/set_status`, { status: 'soft_down', reason: 'Wobbly wheel' });
    const tk = (await admin.get('/api/v1/maintenance_tickets')).body.data.find((x: any) => x.stock_item.barcode === 'BK-3');
    expect(tk).toMatchObject({ status: 'open', priority: 'normal', notes: 'Wobbly wheel' });
    const closed = await admin.post(`/api/v1/maintenance_tickets/${tk.id}/actions/close`, { outcome: 'retired', notes: 'Frame cracked' });
    expect(closed.body.status).toBe('done');
    expect((await unit('BK-3')).status).toBe('retired');
  });

  it('closes a multi-unit ticket on its own once every unit is back in service', async () => {
    const r = (await admin.post('/api/v1/maintenance_tickets', { stock_item_ids: [units['BK-1'], units['BK-2']], title: 'Check lights' })).body;
    await admin.post(`/api/v1/stock_items/${units['BK-2']}/actions/set_status`, { status: 'available', reason: 'Lights fine' });
    expect((await admin.get(`/api/v1/maintenance_tickets/${r.id}`)).body.status).toBe('open');
    await admin.post(`/api/v1/stock_items/${units['BK-1']}/actions/set_status`, { status: 'available', reason: 'Lights fine' });
    expect((await admin.get(`/api/v1/maintenance_tickets/${r.id}`)).body.status).toBe('done');
  });
});
