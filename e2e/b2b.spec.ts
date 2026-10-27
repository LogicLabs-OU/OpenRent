import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, messageHtml, ADMIN, STORE, collectErrors, hydrated, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// Business customers (FR-CUS-7): account terms, PO numbers at reserve and booking on account online.
test('staff set account terms, need the PO number at reserve, and the customer books on account online', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const email = `b2b-${stamp}@example.com`;
  const customer = await call(page, 'POST', '/customers', { type: 'company', name: `E2E Build Co ${stamp}`, email });
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Scaffold ${stamp}`, tracking: 'bulk', visibility: 'public', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location.id}`, { quantity: 20 });

  // Terms on the customer page.
  await page.goto(`${ADMIN}/customers/${customer.id}`);
  const card = page.getByTestId('customer-terms');
  await card.getByLabel('Books on account').click();
  await card.getByLabel('Payment terms (days)').fill('30');
  await card.getByLabel('Credit limit').fill('2000');
  await card.getByLabel('Needs a purchase order number').click();
  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await call(page, 'GET', `/customers/${customer.id}`)).b2b).toEqual({ on_account: true, payment_terms_days: 30, credit_limit: 200000, po_required: true, invoice_schedule: 'per_order' });
  // Not on a hovered button: axe checks the colours at rest.
  await page.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="customer-terms"]').analyze();
  expect(axe.violations).toEqual([]);

  // Reserve asks for the PO number next to its field.
  const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
  const end = new Date(start.getTime() + 86400_000);
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: start.toISOString(), ends_at: end.toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  await page.goto(`${ADMIN}/orders/${order.id}`);
  await page.getByRole('button', { name: 'Reserve' }).first().click();
  await expect(page.getByText('This customer needs a purchase order number on every booking')).toBeVisible();
  await page.getByLabel('Purchase order number').fill('PO-E2E-1');
  await page.getByLabel('Purchase order number').press('Tab');
  await expect.poll(async () => (await call(page, 'GET', `/orders/${order.id}`)).po_number).toBe('PO-E2E-1');
  await page.getByRole('button', { name: 'Reserve' }).first().click();
  await expect(page.getByText('Reserved').first()).toBeVisible();

  // The customer signs in and books on account.
  await call(page, 'POST', '/storefront/account/login', { email });
  const log = await call(page, 'GET', '/notifications?limit=50');
  const msg = log.data.find((n: any) => n.template === 'customer_login' && n.recipient === email);
  const html: string = (await messageHtml(msg.id)).replace(/&#x3D;/g, '=').replace(/&amp;/g, '&');
  const token = new URL(/href="([^"]*\/account\/verify\?token=[\w-]+)"/.exec(html)![1]!).searchParams.get('token')!;
  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(`${STORE}/account/verify?token=${token}`);
  await hydrated(shopper);
  await shopper.getByRole('button', { name: 'Sign in' }).click();
  // The sign-in is a full round trip; it can be slow while the whole suite runs.
  await expect(shopper).toHaveURL(/\/account$/, { timeout: 20_000 });
  const from = new Date(start.getTime() + 7 * 86400_000);
  await shopper.request.post(`${STORE}/_or/dates`, { data: { from: from.toISOString(), to: new Date(from.getTime() + 86400_000).toISOString() } });
  await shopper.request.post(`${STORE}/_or/cart`, { data: { variant_id: product.variants[0].id, quantity: 1 } });
  await shopper.goto(`${STORE}/checkout`);
  await hydrated(shopper);
  const b2b = shopper.getByTestId('checkout-on-account');
  await expect(b2b).toContainText('due within 30 days');
  await shopper.getByLabel('Full name').fill(customer.name);
  await shopper.getByLabel('Email').fill(email);
  await b2b.getByLabel('Pay on account (invoice)').click();
  await shopper.getByLabel('I accept the rental terms').check();
  await shopper.getByRole('button', { name: /place booking/i }).click();
  // The PO number is still needed, next to its field.
  await expect(b2b.getByText('This customer needs a purchase order number on every booking')).toBeVisible();
  await b2b.getByLabel('Purchase order number').fill('PO-WEB-7');
  await shopper.getByRole('button', { name: /place booking/i }).click();
  await expect(shopper.getByRole('heading', { name: /thank you, your booking #\d+/i })).toBeVisible({ timeout: 15_000 });
  const listed = (await call(page, 'GET', `/customers/${customer.id}/orders?limit=10`)).data.find((o: any) => o.source === 'storefront');
  const online = await call(page, 'GET', `/orders/${listed.id}`);
  expect([online.status, online.po_number, online.payment_status]).toEqual(['reserved', 'PO-WEB-7', 'unpaid']);
  await shopper.context().close();

  // Both bookings are owed on the customer's account.
  await page.goto(`${ADMIN}/customers/${customer.id}`);
  await expect(page.getByTestId('customer-owed')).not.toHaveText(/^€0\.00$/);
  for (const o of [order, online]) await call(page, 'POST', `/orders/${o.id}/actions/cancel`, { notify: false });
  expect(errors).toEqual([]);
});
