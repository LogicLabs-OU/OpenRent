import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// Long rentals billed per period while out (FR-OR-11).
test('staff set a long rental to monthly billing; pickup invoices the first month', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const customer = await call(page, 'POST', '/customers', { name: `E2E Site Office ${stamp}`, email: `site-${stamp}@example.com` });
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Container ${stamp}`, tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 1500 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location.id}`, { quantity: 2 });
  const start = new Date(Date.now() - 3600_000);
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });

  await page.goto(`${ADMIN}/orders/${order.id}`);
  await page.getByLabel('Billing').selectOption({ label: 'Every month while out' });
  await expect(page.getByText('Each period is invoiced when it starts')).toBeVisible();
  await expect.poll(async () => (await call(page, 'GET', `/orders/${order.id}`)).billing_cycle).toBe('monthly');
  await page.getByRole('button', { name: 'Mark picked up' }).click();
  await expect(page.getByText('Out', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Billed until /)).toBeVisible();
  await expect(page.getByLabel('Billing')).toBeDisabled();
  const docs = (await call(page, 'GET', `/orders/${order.id}?expand=documents`)).documents.filter((d: any) => d.type === 'invoice');
  expect(docs).toHaveLength(1);
  await expect(page.getByRole('button', { name: new RegExp(`Invoice ${docs[0].number}`) })).toBeVisible();
  await call(page, 'POST', `/orders/${order.id}/actions/check_in`, { all: true });
  expect(errors).toEqual([]);
});
