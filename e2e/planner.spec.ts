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

test('staff move a booking between units on the planner, by dragging and from its menu', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Plan camera ${stamp}`, visibility: 'hidden', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default).id;
  for (const n of [1, 2, 3]) await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location, barcode: `PL${stamp}-${n}` });
  const customer = await call(page, 'POST', '/customers', { name: 'Plan Customer', email: `pw-plan-${stamp}@example.com` });
  const day = (n: number) => {
    const d = new Date(Date.now() + n * 86400_000);
    d.setUTCHours(10, 0, 0, 0);
    return d.toISOString();
  };
  const book = async (barcode: string) => {
    const o = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: day(2), ends_at: day(3), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
    await call(page, 'POST', `/orders/${o.id}/actions/reserve`, {});
    await call(page, 'POST', `/orders/${o.id}/actions/assign_units`, { barcodes: [barcode] });
    return o;
  };
  const a = await book(`PL${stamp}-1`);
  const b = await book(`PL${stamp}-3`);

  await page.goto(`${ADMIN}/planner`);
  await page.getByLabel('Products').selectOption({ label: `Plan camera ${stamp}` });
  const row = (n: number) => page.getByTestId('planner-row').filter({ has: page.getByRole('link', { name: `PL${stamp}-${n}` }) });
  const bar = (n: number) => row(n).getByTestId('planner-bar').filter({ hasText: `#${a.number}` });
  await expect(bar(1)).toBeVisible();
  await shot(page, 'admin-planner');

  // Drag to the free unit.
  await bar(1).dragTo(row(2).locator('div.relative'));
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `#${a.number} now uses PL${stamp}-2` }).last()).toBeVisible();
  await expect(bar(2)).toBeVisible();
  await expect(bar(1)).toHaveCount(0);

  // The menu does the same without a mouse; a unit that is taken is refused and the bar stays.
  await bar(2).click();
  await page.getByTestId('planner-menu').getByRole('button', { name: `PL${stamp}-3` }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'already booked' }).last()).toBeVisible();
  await expect(bar(2)).toBeVisible();
  await bar(2).click();
  await page.getByTestId('planner-menu').getByRole('button', { name: `PL${stamp}-1` }).click();
  await expect(bar(1)).toBeVisible();
  // The bar moves as soon as the move is sent; the booking changes when it is saved.
  await expect.poll(async () => (await call(page, 'GET', `/orders/${a.id}`)).lines[0].units.map((u: any) => u.barcode)).toEqual([`PL${stamp}-1`]);
  for (const o of [a, b]) await call(page, 'POST', `/orders/${o.id}/actions/cancel`, {});
  expect(errors).toEqual([]);
});
