import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff choose the card-hold policy, and customers see damage on their order page', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=payments`);
  await expect(page.getByTestId('reconciliation')).toBeVisible();
  try {
    await page.getByLabel('When a card hold is about to expire').selectOption('reauthorize');
    await expect.poll(async () => (await call(page, 'GET', '/tenant/settings')).deposit_expiry_policy).toBe('reauthorize');
    await shot(page, 'admin-payment-settings');
  } finally {
    await call(page, 'PATCH', '/tenant/settings', { deposit_expiry_policy: 'notify' });
  }

  // A returned booking with damage found at inspection.
  const chairs = (await call(page, 'GET', '/products?q=Folding%20chair')).data.find((p: { name: string }) => p.name === 'Folding chair');
  const customer = await call(page, 'POST', '/customers', { name: 'Dee Mage', email: `dmg-${Date.now()}@example.com` });
  const starts = new Date(Date.now() + 2 * 3600_000);
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 86400_000).toISOString(), lines: [{ variant_id: chairs.variants[0].id, quantity: 2 }] });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });
  await call(page, 'POST', `/orders/${order.id}/actions/check_out`, {});
  await call(page, 'POST', `/orders/${order.id}/actions/check_in`, { all: true });
  await call(page, 'POST', `/orders/${order.id}/actions/inspect`, { damage_charges: [{ description: 'Bent leg', amount: 1500 }], notify: false });

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(`${STORE}/order/${order.public_token}`);
  await hydrated(shopper);
  const damage = shopper.getByTestId('order-damage');
  await expect(damage).toContainText('Damage charges');
  await expect(damage).toContainText('Bent leg');
  await shot(shopper, 'sf-order-damage');
  expect(errors).toEqual([]);
});
