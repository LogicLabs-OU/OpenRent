import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff read the meter at pickup and return, and the hours beyond the included ones are charged', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const product = await call(page, 'POST', '/products', {
    type: 'rental', name: `E2E Digger ${stamp}`, visibility: 'hidden', tracking: 'serialized', buffer_after_min: 0, meter_unit: 'h',
    price: { kind: 'per_period', period_unit: 'day', amount: 20000 },
  });
  // The meter price is set on the product page, next to the meter unit.
  await page.goto(`${ADMIN}/products/${product.id}`);
  await page.getByLabel('Price per h used').fill('12.50');
  await page.getByLabel('h included per rental').fill('8');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' })).toBeVisible();
  expect((await call(page, 'GET', `/products/${product.id}`)).meter_rate).toEqual({ amount: 1250, included: 8 });

  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default).id;
  await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location, barcode: `DG-${stamp}` });
  const customer = await call(page, 'POST', '/customers', { name: 'Site Works', email: `site-${stamp}@example.com` });
  const order = await call(page, 'POST', '/orders', {
    customer_id: customer.id,
    starts_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    ends_at: new Date(Date.now() + 5 * 3600_000).toISOString(),
    lines: [{ variant_id: product.variants[0].id, quantity: 1 }],
  });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });
  await call(page, 'POST', `/orders/${order.id}/actions/assign_units`, { barcodes: [`DG-${stamp}`] });
  try {
    await page.goto(`${ADMIN}/orders/${order.id}`);
    // Without a reading the pickup is refused at the meter field.
    await page.getByRole('button', { name: 'Mark picked up' }).click();
    const pickup = page.getByLabel(`Meter of DG-${stamp} at pickup (h)`);
    await expect(page.getByText(`Enter the meter reading of DG-${stamp} (h); its use is charged`)).toBeVisible();
    await pickup.fill('100');
    await page.getByRole('button', { name: 'Mark picked up' }).click();
    await expect.poll(async () => (await call(page, 'GET', `/orders/${order.id}`)).status).toBe('out');

    await page.reload();
    await page.getByRole('button', { name: 'Check in', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(`Meter of DG-${stamp} at return (h)`).fill('112');
    await dialog.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByText(`E2E Digger ${stamp} DG-${stamp}: 4 h beyond the 8 h included (100 to 112)`)).toBeVisible();
    await shot(page, 'admin-meter-charge');
    const o = await call(page, 'GET', `/orders/${order.id}`);
    expect(o.lines.find((l: any) => l.type === 'fee').subtotal.amount).toBe(5000);
  } finally {
    const o = await call(page, 'GET', `/orders/${order.id}`);
    if (o.status === 'out') await call(page, 'POST', `/orders/${order.id}/actions/check_in`, { all: true, meter_readings: [{ barcode: `DG-${stamp}`, value: 200 }] });
    if (o.status === 'reserved') await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
  }
  expect(errors).toEqual([]);
});
