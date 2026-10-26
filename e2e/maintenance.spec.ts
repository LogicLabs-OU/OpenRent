import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff open one ticket for two units, track parts and cost, and resolve it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Repair bike ${stamp}`, visibility: 'hidden', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default).id;
  const units = [];
  for (const n of [1, 2]) units.push(await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location, barcode: `RB${stamp}-${n}` }));
  const me = (await call(page, 'GET', '/auth/me')).user;

  await page.goto(`${ADMIN}/maintenance`);
  await page.getByRole('button', { name: 'New ticket' }).click();
  const sheet = page.getByRole('dialog');
  for (const u of units) {
    await sheet.getByLabel('Units').fill(u.barcode);
    await sheet.getByLabel('Units').press('Enter');
    await expect(sheet.getByTestId('ticket-unit').filter({ hasText: u.barcode })).toBeVisible();
  }
  await sheet.getByLabel('Issue').fill(`Gears slip ${stamp}`);
  await sheet.getByLabel('Priority').selectOption('high');
  await sheet.getByLabel('Assigned to').selectOption(me.id);
  await sheet.getByRole('button', { name: 'Open ticket' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Ticket opened' }).last()).toBeVisible();
  for (const u of units) expect((await call(page, 'GET', `/stock_items/${u.id}`)).status).toBe('soft_down');

  // The ticket is in "My tickets".
  await page.keyboard.press('Escape');
  await page.getByLabel('My tickets').click();
  const row = page.getByTestId('maintenance-table').getByRole('row').filter({ hasText: `Gears slip ${stamp}` });
  await expect(row).toContainText('High');
  await row.click();

  const detail = page.getByRole('dialog');
  await detail.getByRole('button', { name: 'Start repair' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Repair started' }).last()).toBeVisible();
  await detail.getByRole('button', { name: 'Add a part' }).click();
  await detail.getByLabel('Part', { exact: true }).fill('Chain');
  await detail.getByLabel('Quantity').fill('2');
  await detail.getByLabel('Cost each').fill('12.50');
  await detail.getByLabel('Labour cost').fill('30');
  await detail.getByRole('button', { name: 'Save' }).click();
  await expect(detail).toContainText('Total cost: €55.00');
  await shot(page, 'admin-maintenance-ticket');
  await detail.getByLabel('What was done').fill('New chains on both');
  await detail.getByRole('button', { name: 'Back in service' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'is back in service' }).last()).toBeVisible();
  for (const u of units) expect((await call(page, 'GET', `/stock_items/${u.id}`)).status).toBe('available');
  expect(errors).toEqual([]);
});
