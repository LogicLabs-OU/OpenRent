import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    data,
    headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('counter staff pick up with a scanner and signature, count stock and close a repair', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await signIn(page);

  const kayak = (await call(page, 'GET', '/products?q=Sea%20kayak')).data[0];
  const customer = await call(page, 'POST', '/customers', {
    name: 'Scan Tester',
    email: `scan-${Date.now()}@example.com`,
  });
  const starts = new Date(Date.now() + 5 * 60_000).toISOString();
  const ends = new Date(Date.now() + 5 * 3600_000).toISOString();
  const order = await call(page, 'POST', '/orders', {
    customer_id: customer.id,
    starts_at: starts,
    ends_at: ends,
    lines: [{ variant_id: kayak.variants[0].id, quantity: 1 }],
  });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });

  // Pick up mode: scan the order, then a free unit, sign and hand over.
  await page.goto(`${ADMIN}/scan`);
  await page.getByRole('radio', { name: 'Pick up' }).click();
  const input = page.getByLabel('Type or scan a code');
  await input.fill(String(order.number));
  await input.press('Enter');
  await expect(page.getByTestId('scan-order')).toContainText(`Order #${order.number}`);
  let assigned = false;
  for (const code of ['KY-001', 'KY-002', 'KY-003', 'KY-004']) {
    await input.fill(code);
    await input.press('Enter');
    const entry = page.locator('[data-tone]').first();
    await expect(entry).toContainText(code);
    if ((await entry.getAttribute('data-tone')) === 'ok') {
      assigned = true;
      break;
    }
  }
  expect(assigned).toBe(true);
  const pad = page.locator('canvas');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(box.x + 20 + i * 18, box.y + box.height / 2 + (i % 2 ? -18 : 18));
  await page.mouse.up();
  await shot(page, 'admin-scan-pickup');
  await page.getByRole('button', { name: 'Mark picked up' }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: `Order #${order.number} is picked up` }),
  ).toBeVisible();
  expect((await call(page, 'GET', `/orders/${order.id}`)).status).toBe('out');
  const contract = (await call(page, 'GET', `/documents?order_id=${order.id}&type=contract`)).data[0];
  expect(contract).toBeTruthy();
  // Return the unit so repeated runs on one database keep stock available.
  await call(page, 'POST', `/orders/${order.id}/actions/check_in`, { all: true });

  // Stock take: start, scan one unit, then discard.
  await page.getByRole('radio', { name: 'Stock take' }).click();
  await page.getByRole('button', { name: 'Start counting' }).click();
  await input.fill('KY-004');
  await input.press('Enter');
  await expect(page.getByTestId('stock-take')).toBeVisible();
  await shot(page, 'admin-stock-take');
  await page.getByRole('button', { name: 'Discard count' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard count' }).click();
  await expect(page.getByRole('button', { name: 'Start counting' })).toBeVisible();

  // Maintenance: a unit set to hard down gets a ticket; closing it puts the unit back.
  const unit = (
    await call(
      page,
      'GET',
      `/stock_items?filter[variant_id]=${kayak.variants[0].id}&filter[status]=available&limit=1`,
    )
  ).data[0];
  await call(page, 'POST', `/stock_items/${unit.id}/actions/set_status`, {
    status: 'hard_down',
    reason: 'Crack in hull (e2e)',
  });
  await page.goto(`${ADMIN}/maintenance`);
  await page.getByTestId('maintenance-table').getByRole('row').filter({ hasText: unit.barcode }).click();
  await expect(page.getByRole('dialog').getByLabel('Notes')).toHaveValue(/Crack in hull/);
  await shot(page, 'admin-maintenance');
  await page.getByRole('button', { name: 'Back in service' }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: `${unit.barcode} is back in service` }),
  ).toBeVisible();
  expect((await call(page, 'GET', `/stock_items/${unit.id}`)).status).toBe('available');
  expect(errors).toEqual([]);
});
