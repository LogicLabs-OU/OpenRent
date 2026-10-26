import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  return page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
}

test('pickup waits until staff mark the customer’s ID as checked', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const customer = await (await call(page, 'POST', '/customers', { name: 'Ida Check', email: `ida-${Date.now()}@example.com`, flags: { requires_id_check: true } })).json();
  const chairs = (await (await call(page, 'GET', '/products?q=Folding%20chair')).json()).data.find((p: { name: string }) => p.name === 'Folding chair');
  const starts = new Date(Date.now() + 2 * 3600_000);
  const order = await (await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 86400_000).toISOString(), lines: [{ variant_id: chairs.variants[0].id, quantity: 1 }] })).json();
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });

  const refused = await call(page, 'POST', `/orders/${order.id}/actions/check_out`, {});
  expect(refused.status()).toBe(409);
  expect((await refused.json()).detail).toBe('Check the customer’s ID before pickup');

  await page.goto(`${ADMIN}/customers/${customer.id}`);
  await page.getByRole('switch', { name: 'ID checked' }).click();
  await expect.poll(async () => (await (await call(page, 'GET', `/customers/${customer.id}`)).json()).flags.id_verified).toBe(true);
  expect((await call(page, 'POST', `/orders/${order.id}/actions/check_out`, {})).status()).toBe(200);
  expect(errors).toEqual([]);
});
