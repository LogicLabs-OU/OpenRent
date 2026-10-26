/**
 * Demo shop (PRD §10.3): bikes, cameras, party furniture and kayaks with units, prices,
 * customers and orders in every lifecycle state. Built through core services so it obeys
 * every invariant the API does.
 */
import { catalog, customers, inventory, orders, payments, zonedTimeToUtc, localDate, addLocalDays, parseLocalDate, type Ctx } from '@openrent/core';

const at = (ctx: Ctx, tz: string, dayOffset: number, hour: number) => {
  const d = parseLocalDate(addLocalDays(localDate(ctx.now, tz), dayOffset));
  return zonedTimeToUtc(d.year, d.month, d.day, hour, 0, tz).toISOString();
};

async function freeUnits(ctx: Ctx, variantId: string, n: number, from: string, to: string): Promise<string[]> {
  const r = await ctx.db.query<{ id: string }>(
    `SELECT s.id FROM stock_items s WHERE s.variant_id = $1 AND s.status = 'available'
       AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.stock_item_id = s.id AND a.period && tstzrange($2, $3, '[)'))
     ORDER BY s.barcode LIMIT $4`,
    [variantId, from, to, n],
  );
  return r.rows.map((x) => x.id);
}

export async function seedDemoCatalog(ctx: Ctx) {
  const tz = (await ctx.db.query(`SELECT timezone FROM tenants WHERE id = $1`, [ctx.tenantId])).rows[0].timezone as string;
  const location = (await ctx.db.query(`SELECT id FROM locations WHERE deleted_at IS NULL ORDER BY is_default DESC LIMIT 1`)).rows[0].id as string;
  const sys: Ctx = { ...ctx, actor: { type: 'system', id: null } };

  const cat = async (name: string, position: number) => (await catalog.categories.create(sys, { name, position })).id;
  const bikes = await cat('Bikes', 1);
  const cameras = await cat('Cameras', 2);
  const party = await cat('Party & events', 3);
  const outdoor = await cat('Outdoor', 4);
  const accessories = await cat('Accessories', 5);

  const city = await catalog.createProduct(sys, {
    type: 'rental', name: 'City bike', description: 'Comfortable 7-speed city bike with lock, lights and basket.', category_ids: [bikes], deposit_amount: 10000,
    buffer_after_min: 30, min_duration_min: 120, tags: ['popular'],
    variants: ['S', 'M', 'L'].map((size, i) => ({ name: `Size ${size}`, tracking: 'serialized' as const, options: { size }, position: i, price: { kind: 'per_period' as const, period_unit: 'day' as const, amount: 2500 } })),
  });
  const ebike = await catalog.createProduct(sys, {
    type: 'rental', name: 'E-bike', description: 'Electric bike with 80 km range. Charged between rentals.', category_ids: [bikes], deposit_amount: 30000, buffer_after_min: 120,
    tracking: 'serialized', price: { kind: 'tiered', period_unit: 'day', amount: 4500, tiers: [{ from: 1, pct_bp: 10000 }, { from: 2, pct_bp: 7000 }], cap: { every: 7, charge: 5 } },
  });
  const r5 = await catalog.createProduct(sys, {
    type: 'rental', name: 'Canon EOS R5 body', description: '45 MP full-frame mirrorless body with two batteries.', category_ids: [cameras], deposit_amount: 50000, buffer_before_min: 60, buffer_after_min: 60,
    tracking: 'serialized', price: { kind: 'tiered', period_unit: 'day', amount: 9000, tiers: [{ from: 1, pct_bp: 10000 }, { from: 2, pct_bp: 5000 }], cap: { every: 7, charge: 4 } },
  });
  const lens = await catalog.createProduct(sys, {
    type: 'rental', name: 'RF 24-70mm f/2.8 lens', description: 'Standard zoom lens.', category_ids: [cameras], deposit_amount: 20000, buffer_after_min: 60,
    tracking: 'serialized', price: { kind: 'tiered', period_unit: 'day', amount: 4000, tiers: [{ from: 1, pct_bp: 10000 }, { from: 2, pct_bp: 5000 }], cap: { every: 7, charge: 4 } },
  });
  const kit = await catalog.createProduct(sys, {
    type: 'bundle', name: 'R5 filmmaker kit', description: 'R5 body and 24-70mm lens, 10% cheaper than renting separately.', category_ids: [cameras],
    bundle: { pricing_mode: 'discount_pct', discount_bp: 1000, components: [{ variant_id: r5.variants[0]!.id, quantity: 1 }, { variant_id: lens.variants[0]!.id, quantity: 1 }] },
  });
  const table = await catalog.createProduct(sys, { type: 'rental', name: 'Folding table 180 cm', category_ids: [party], tracking: 'bulk', buffer_after_min: 60, price: { kind: 'per_period', period_unit: 'day', amount: 800 } });
  const chair = await catalog.createProduct(sys, { type: 'rental', name: 'Folding chair', category_ids: [party], tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 150 } });
  const kayak = await catalog.createProduct(sys, {
    type: 'rental', name: 'Sea kayak', description: 'Single sea kayak with paddle and spray deck.', category_ids: [outdoor], deposit_amount: 15000, min_duration_min: 240,
    tracking: 'serialized', price: { kind: 'table', period_unit: 'day', amount: 0, price_table: [{ periods: 1, amount: 3500 }, { periods: 2, amount: 6000 }, { periods: 7, amount: 15000 }], extra_per_period: 1500 },
  });
  const helmet = await catalog.createProduct(sys, { type: 'rental', name: 'Helmet', category_ids: [accessories], tracking: 'bulk', price: { kind: 'fixed', period_unit: 'day', amount: 500 } });
  const delivery = await catalog.createProduct(sys, { type: 'service', name: 'Delivery and collection', category_ids: [party], price: { kind: 'fixed', period_unit: 'day', amount: 4500 } });
  const gas = await catalog.createProduct(sys, { type: 'sale', name: 'Camping gas canister', category_ids: [outdoor], tracking: 'bulk', price: { kind: 'fixed', period_unit: 'day', amount: 900 } });

  const units = async (variantId: string, n: number, prefix: string) => {
    for (let i = 1; i <= n; i++) await inventory.createStockItem(sys, { variant_id: variantId, location_id: location, barcode: `${prefix}-${String(i).padStart(3, '0')}`, serial: `${prefix}${1000 + i}`, purchase_price: 0 });
  };
  for (const v of city.variants) await units(v.id, 3, `CB${v.options.size}`);
  await units(ebike.variants[0]!.id, 4, 'EB');
  await units(r5.variants[0]!.id, 2, 'R5');
  await units(lens.variants[0]!.id, 3, 'L2470');
  await units(kayak.variants[0]!.id, 4, 'KY');
  await inventory.setStockLevel(sys, table.variants[0]!.id, location, 40, 'initial stock');
  await inventory.setStockLevel(sys, chair.variants[0]!.id, location, 200, 'initial stock');
  await inventory.setStockLevel(sys, helmet.variants[0]!.id, location, 20, 'initial stock');
  await inventory.setStockLevel(sys, gas.variants[0]!.id, location, 30, 'initial stock');

  await catalog.coupons.create(sys, { code: 'AUTUMN10', kind: 'percent', value: 1000, scope: { type: 'order' }, combinable: false });

  const people: [string, string, string][] = [
    ['Mari Tamm', 'mari@example.com', '+372 5555 1001'],
    ['Jonas Becker', 'jonas@example.com', '+49 151 2345678'],
    ['Sophie Martin', 'sophie@example.com', '+33 6 12 34 56 78'],
    ['Lucas de Vries', 'lucas@example.com', '+31 6 1234 5678'],
    ['Elena García', 'elena@example.com', '+34 612 345 678'],
    ['Northwind Events OÜ', 'events@northwind.example', '+372 600 0000'],
    ['Priya Shah', 'priya@example.com', '+44 7700 900123'],
    ['Tom Novak', 'tom@example.com', '+420 601 234 567'],
  ];
  const cust: string[] = [];
  for (const [name, email, phone] of people) {
    const c = await customers.createCustomer(sys, { name, email, phone, type: name.includes('OÜ') ? 'company' : 'person', company_name: name.includes('OÜ') ? name : null, flags: name.startsWith('Mari') ? { deposit_waived: true } : {} });
    cust.push(c.id);
  }

  const mk = async (customer: number, d0: number, h0: number, d1: number, h1: number, lines: any[], coupon?: string) =>
    orders.createOrder(sys, { customer_id: cust[customer], location_id: location, starts_at: at(ctx, tz, d0, h0), ends_at: at(ctx, tz, d1, h1), lines, coupon_codes: coupon ? [coupon] : [] });
  const quiet = { notify: false };
  const out = async (o: any, items: [string, number][]) => {
    const ids: string[] = [];
    for (const [v, n] of items) ids.push(...(await freeUnits(sys, v, n, o.starts_at, o.ends_at)));
    return orders.runAction(sys, o.id, 'check_out', { stock_item_ids: ids, signature: { name: 'Demo customer', method: 'click' } });
  };

  // Draft
  await mk(1, 6, 10, 8, 10, [{ variant_id: kayak.variants[0]!.id, quantity: 2 }, { variant_id: helmet.variants[0]!.id, quantity: 2 }]);
  // Quote holding stock
  const q = await mk(5, 9, 9, 10, 18, [{ variant_id: table.variants[0]!.id, quantity: 12 }, { variant_id: chair.variants[0]!.id, quantity: 80 }, { variant_id: delivery.variants[0]!.id, quantity: 1 }]);
  await orders.runAction(sys, q.id, 'send_quote', quiet);
  // Reserved tomorrow, paid by card terminal
  const r1 = await mk(2, 1, 10, 3, 17, [{ variant_id: city.variants[1]!.id, quantity: 2 }, { variant_id: helmet.variants[0]!.id, quantity: 2 }], 'AUTUMN10');
  await orders.runAction(sys, r1.id, 'reserve', quiet);
  await payments.recordManualPayment(sys, r1.id, { amount: (await orders.getOrder(sys, r1.id)).totals.total.amount, method: 'card_terminal' });
  // Reserved camera kit later this week
  const r2 = await mk(3, 2, 9, 5, 18, [{ variant_id: kit.variants[0]!.id, quantity: 1 }]);
  await orders.runAction(sys, r2.id, 'reserve', quiet);
  // Prepared for pickup today
  const p1 = await mk(4, 0, 15, 2, 12, [{ variant_id: ebike.variants[0]!.id, quantity: 2 }]);
  await orders.runAction(sys, p1.id, 'reserve', quiet);
  await orders.assignUnits(sys, p1.id, { stock_item_ids: await freeUnits(sys, ebike.variants[0]!.id, 2, p1.starts_at, p1.ends_at) });
  await orders.runAction(sys, p1.id, 'prepare', {});
  // Out, due back tomorrow
  const o1 = await mk(0, -1, 10, 1, 17, [{ variant_id: city.variants[0]!.id, quantity: 1 }, { variant_id: city.variants[2]!.id, quantity: 1 }]);
  await orders.runAction(sys, o1.id, 'reserve', quiet);
  await out(o1, [[city.variants[0]!.id, 1], [city.variants[2]!.id, 1]]);
  // Overdue
  const o2 = await mk(6, -4, 10, -1, 12, [{ variant_id: kayak.variants[0]!.id, quantity: 1 }]);
  await orders.runAction(sys, o2.id, 'reserve', quiet);
  await out(o2, [[kayak.variants[0]!.id, 1]]);
  // Returned, one lens needs inspection
  const ret = await mk(7, -6, 9, -2, 18, [{ variant_id: lens.variants[0]!.id, quantity: 1 }, { variant_id: r5.variants[0]!.id, quantity: 1 }]);
  await orders.runAction(sys, ret.id, 'reserve', quiet);
  const retOut = await out(ret, [[lens.variants[0]!.id, 1], [r5.variants[0]!.id, 1]]);
  const retUnits = retOut.lines.flatMap((l: any) => l.units.map((u: any) => ({ id: u.stock_item_id, line: l.description })));
  await orders.runAction(sys, ret.id, 'check_in', { units: retUnits.map((u: any) => ({ stock_item_id: u.id, outcome: u.line.includes('lens') ? 'needs_inspection' : 'ok' })) });
  // Closed and paid
  const c1 = await mk(2, -12, 10, -10, 10, [{ variant_id: ebike.variants[0]!.id, quantity: 1 }]);
  await orders.runAction(sys, c1.id, 'reserve', quiet);
  await out(c1, [[ebike.variants[0]!.id, 1]]);
  await orders.runAction(sys, c1.id, 'check_in', { all: true });
  await payments.recordManualPayment(sys, c1.id, { amount: (await orders.getOrder(sys, c1.id)).totals.balance.amount || 1, method: 'cash' });
  const dep = (await payments.listDeposits(sys, { order_id: c1.id }))[0];
  if (dep) await payments.releaseDeposit(sys, dep.id);
  await orders.runAction(sys, c1.id, 'inspect', {});
  await orders.runAction(sys, c1.id, 'close', {});
  // Cancelled
  const x1 = await mk(1, 4, 10, 5, 10, [{ variant_id: city.variants[1]!.id, quantity: 1 }]);
  await orders.runAction(sys, x1.id, 'reserve', quiet);
  await orders.runAction(sys, x1.id, 'cancel', { reason: 'Plans changed', notify: false });

  return { products: 11, customers: cust.length, orders: 10 };
}
