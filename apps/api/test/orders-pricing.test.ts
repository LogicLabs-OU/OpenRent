import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, isoIn, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** Next weekday (0 = Sunday) at hh:mm Tallinn time, as an ISO string (winter time, UTC+2). */
function nextWeekday(day: number, hh: number, mm = 0) {
  const d = new Date(Date.now() + 7 * 86400_000);
  while (d.getUTCDay() !== day) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hh - 2, mm, 0, 0);
  return d;
}

suite('discounts, charging days, GDPR contacts and translated messages', () => {
  let t: TestApp;
  let admin: Client;
  let bike: string;

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Bike', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
    bike = p.body.variants[0].id;
    const shop = (await admin.get('/api/v1/locations')).body.data[0].id;
    await admin.put(`/api/v1/stock_levels/${bike}/${shop}`, { quantity: 10 });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('spreads manual discount lines over the order and keeps them through repricing', async () => {
    const cus = await admin.post('/api/v1/customers', { name: 'Dee Count', email: 'dee@test.dev' });
    const o = await admin.post('/api/v1/orders', {
      customer_id: cus.body.id,
      starts_at: isoIn(2),
      ends_at: isoIn(4),
      lines: [{ variant_id: bike, quantity: 2 }, { type: 'discount', amount: 1000, description: 'Loyal customer' }],
    });
    expect(o.status).toBe(201);
    // 2 bikes × 2 days × €20 = €80, minus €10.
    expect(o.body.totals.subtotal.amount).toBe(8000);
    expect(o.body.totals.discount.amount).toBe(1000);
    expect(o.body.totals.total.amount).toBe(8400);
    const d = o.body.lines.find((l: any) => l.type === 'discount');
    expect(d.description).toBe('Loyal customer');
    expect(d.unit_price.amount).toBe(1000);
    expect(d.total.amount).toBe(0);

    // A percentage is recomputed when the order changes.
    const pct = await admin.post(`/api/v1/orders/${o.body.id}/lines`, { type: 'discount', percent_bp: 1000 });
    expect(pct.status).toBe(201);
    const after = (await admin.get(`/api/v1/orders/${o.body.id}`)).body;
    expect(after.totals.discount.amount).toBe(1000 + 700);
    const line = after.lines.find((l: any) => l.type === 'rental');
    await admin.patch(`/api/v1/orders/${o.body.id}/lines/${line.id}`, { quantity: 3 });
    const bigger = (await admin.get(`/api/v1/orders/${o.body.id}`)).body;
    expect(bigger.totals.discount.amount).toBe(1000 + 1100);
    expect(bigger.lines.find((l: any) => l.price_snapshot?.percent_bp === 1000)).toBeTruthy();

    // Without an amount or a share the line is refused next to its field.
    const bad = await admin.post(`/api/v1/orders/${o.body.id}/lines`, { type: 'discount' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].field).toMatch(/amount/);

    // The invoice shows the discount on the rental line, not as a separate zero line.
    await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, { notify: false });
    const inv = await admin.post(`/api/v1/orders/${o.body.id}/documents`, { type: 'invoice' });
    expect(inv.status).toBe(201);
    const html = (await admin.get(`/api/v1/documents/${inv.body.id}/html`)).body as string;
    expect(html).not.toContain('Loyal customer');
    expect(html).toContain('−€21.00');
  });

  it('does not charge the pickup and return days when the times fit', async () => {
    const p = await admin.post('/api/v1/products', {
      type: 'rental',
      name: 'Weekend tent',
      tracking: 'bulk',
      price: { kind: 'per_period', period_unit: 'day', amount: 1000, charge_day_rules: { free_pickup_day: true, pickup_after: '16:00', free_return_day: true, return_before: '10:00' } },
    });
    expect(p.status).toBe(201);
    const tent = p.body.variants[0].id;
    // Friday 16:30 → Monday 09:30: three days, two of them free.
    const from = nextWeekday(5, 16, 30);
    const to = new Date(from.getTime() + (2 * 24 + 17) * 3600_000);
    const q = await admin.post('/api/v1/price_quote', { starts_at: from.toISOString(), ends_at: to.toISOString(), lines: [{ variant_id: tent, quantity: 1 }] });
    expect(q.status).toBe(200);
    expect(q.body.lines[0].periods).toBe(3);
    expect(q.body.lines[0].charge_periods).toBe(1);
    expect(q.body.subtotal.amount).toBe(1000);
    // A morning pickup (and an earlier return) pays the first day only.
    const shift = 8 * 3600_000;
    const early = await admin.post('/api/v1/price_quote', { starts_at: new Date(from.getTime() - shift).toISOString(), ends_at: new Date(to.getTime() - shift).toISOString(), lines: [{ variant_id: tent, quantity: 1 }] });
    expect(early.body.subtotal.amount).toBe(2000);
    // Bad times are refused by the schema.
    const bad = await admin.patch(`/api/v1/variants/${tent}`, { price: { kind: 'per_period', period_unit: 'day', amount: 1000, charge_day_rules: { pickup_after: '25:00' } } });
    expect(bad.status).toBe(400);
  });

  it('exports and erases company contacts with the customer (GDPR)', async () => {
    const c = await admin.post('/api/v1/customers', { name: 'Acme Events', type: 'company', email: 'office@acme.test' });
    await admin.post(`/api/v1/customers/${c.body.id}/contacts`, { name: 'Pat Planner', email: 'pat@acme.test', phone: '+372 5000 0000' });
    const exp = await admin.get(`/api/v1/customers/${c.body.id}/export`);
    expect(exp.body.contacts).toEqual([expect.objectContaining({ name: 'Pat Planner', email: 'pat@acme.test' })]);
    const anon = await admin.post(`/api/v1/customers/${c.body.id}/actions/anonymize`);
    expect(anon.status).toBe(200);
    expect(anon.body.name).toBe('Anonymised customer');
    expect((await admin.get(`/api/v1/customers/${c.body.id}/contacts`)).body.data).toEqual([]);
  });

  it('lets a variant override the product’s booking rules', async () => {
    const p = await admin.post('/api/v1/products', {
      type: 'rental',
      name: 'Kayak',
      tracking: 'bulk',
      buffer_after_min: 30,
      price: { kind: 'per_period', period_unit: 'day', amount: 3000 },
      variants: [{ name: 'Single' }, { name: 'Double', max_duration_min: 1440, buffer_after_min: 120 }],
    });
    expect(p.status).toBe(201);
    const [single, double] = p.body.variants;
    expect(double.max_duration_min).toBe(1440);
    expect(single.max_duration_min).toBeNull();
    const shop = (await admin.get('/api/v1/locations')).body.data[0].id;
    for (const v of [single, double]) { const r = await admin.put(`/api/v1/stock_levels/${v.id}/${shop}`, { quantity: 2 }); expect(r.status, JSON.stringify(r.body)).toBe(200); }
    const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
    const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(3), ends_at: isoIn(6), lines: [{ variant_id: single.id, quantity: 1 }, { variant_id: double.id, quantity: 1 }] });
    const byVariant = Object.fromEntries(cs.body.availability.map((a: any) => [a.variant_id, a]));
    expect(byVariant[single.id], JSON.stringify(cs.body.availability)).toMatchObject({ ok: true });
    expect(byVariant[double.id].problems[0]).toMatchObject({ code: 'above_max_duration', message: 'The maximum rental is 1440 minutes' });
    // Order lines take the variant's buffer, else the product's.
    const cus = await admin.post('/api/v1/customers', { name: 'Vera Variant' });
    const o = await admin.post('/api/v1/orders', { customer_id: cus.body.id, starts_at: isoIn(3), ends_at: isoIn(4), lines: [{ variant_id: single.id, quantity: 1 }, { variant_id: double.id, quantity: 1 }] });
    expect(o.body.lines.map((l: any) => l.buffer_after_min)).toEqual([30, 120]);
    // A longest rental below the shortest is refused next to the field; null goes back to the product.
    const bad = await admin.patch(`/api/v1/variants/${double.id}`, { min_duration_min: 2880 });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].field).toBe('max_duration_min');
    expect((await admin.patch(`/api/v1/variants/${double.id}`, { max_duration_min: null })).body.max_duration_min).toBeNull();
  });

  it('adds locations and archives one only when it is empty', async () => {
    const before = (await admin.get('/api/v1/locations')).body.data;
    const main = before[0];
    const harbour = await admin.post('/api/v1/locations', { name: 'Harbour', timezone: 'Europe/Helsinki', address: { line1: 'Sadama 1', city: 'Tallinn' } });
    expect(harbour.status).toBe(201);
    expect(harbour.body.is_default).toBe(false);
    // Stock at the location blocks archiving.
    const p = await admin.post('/api/v1/products', { type: 'rental', name: 'Paddle', tracking: 'bulk', price: { kind: 'fixed', amount: 500 } });
    await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${harbour.body.id}`, { quantity: 3 });
    const blocked = await admin.del(`/api/v1/locations/${harbour.body.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('location_has_stock');
    const zero = await admin.put(`/api/v1/stock_levels/${p.body.variants[0].id}/${harbour.body.id}`, { quantity: 0 });
    expect(zero.status, JSON.stringify(zero.body)).toBe(200);
    // Making it the default, then archiving it, hands the default back.
    await admin.patch(`/api/v1/locations/${harbour.body.id}`, { is_default: true });
    const archived = await admin.del(`/api/v1/locations/${harbour.body.id}`);
    expect(archived.status, JSON.stringify(archived.body)).toBeLessThan(300);
    const after = (await admin.get('/api/v1/locations')).body.data;
    expect(after.map((l: any) => l.id)).toEqual([main.id]);
    expect(after[0].is_default).toBe(true);
    // The last location stays.
    const last = await admin.del(`/api/v1/locations/${main.id}`);
    expect(last.status).toBe(409);
    expect(last.body.code).toBe('last_location');
  });

  it('explains prices and refuses actions in the staff member’s language', async () => {
    expect((await admin.patch('/api/v1/auth/me', { locale: 'de' })).status).toBe(200);
    try {
      const q = await admin.post('/api/v1/price_quote', { starts_at: isoIn(2), ends_at: isoIn(4), lines: [{ variant_id: bike, quantity: 1 }] });
      expect(q.body.lines[0].explanation_items[0]).toEqual({ key: 'per_period', params: { count: 2, amount: 2000, unit: 'day' } });
      expect(q.body.lines[0].explanation[0].replace(/\s/g, ' ')).toBe('2 × 20,00 € pro Tag');
      // An order without a customer cannot be reserved; the reason is German.
      const o = await admin.post('/api/v1/orders', { starts_at: isoIn(2), ends_at: isoIn(4), lines: [{ variant_id: bike, quantity: 1 }] });
      const r = await admin.post(`/api/v1/orders/${o.body.id}/actions/reserve`, {});
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.body)).toContain('Fügen Sie einen Kunden hinzu');
      const actions = (await admin.get(`/api/v1/orders/${o.body.id}`)).body.actions;
      expect(actions.find((a: any) => a.action === 'reserve').label).not.toBe('Reserve');
      // Booking rules too.
      const shortStay = await admin.post('/api/v1/products', { type: 'rental', name: 'Boat', tracking: 'bulk', min_duration_min: 1440, price: { kind: 'fixed', amount: 100 } });
      const boat = shortStay.body.variants[0].id;
      const shop = (await admin.get('/api/v1/locations')).body.data[0].id;
      // Without stock the shortage comes first, also in German.
      const none = await admin.post('/api/v1/orders', { customer_id: (await admin.post('/api/v1/customers', { name: 'Nina' })).body.id, starts_at: isoIn(2), ends_at: isoIn(4), lines: [{ variant_id: boat, quantity: 1 }] });
      expect((await admin.post(`/api/v1/orders/${none.body.id}/actions/reserve`, { notify: false })).body.detail).toBe('Boat ist nicht verfügbar');
      await admin.put(`/api/v1/stock_levels/${boat}/${shop}`, { quantity: 1 });
      // Shoppers get booking rules in their browser language.
      const sf = new Client(t.app, { 'x-tenant-slug': 'test-rentals', 'accept-language': 'de-AT,de;q=0.9' });
      const cs = await sf.post('/api/v1/storefront/checkout_sessions', { starts_at: isoIn(2), ends_at: isoIn(2, 12), lines: [{ variant_id: boat, quantity: 1 }] });
      expect(cs.status).toBe(201);
      expect(cs.body.availability[0].problems[0].message).toBe('Die Mindestmietdauer beträgt 1440 Minuten');
    } finally {
      await admin.patch('/api/v1/auth/me', { locale: 'en' });
    }
  });
});
