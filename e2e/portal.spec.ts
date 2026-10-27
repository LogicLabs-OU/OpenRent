import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, messageHtml, ADMIN, STORE, collectErrors, hydrated, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// The customer portal (FR-CUS-6) on the storefront account page, opened from a link staff send.
test('staff send an account link; the customer sees what is owed and uploads an insurance certificate', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const email = `portal-${stamp}@example.com`;
  const customer = await call(page, 'POST', '/customers', { name: `Paula Portal ${stamp}`, email });
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Trailer ${stamp}`, tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location.id}`, { quantity: 3 });
  const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });

  await page.goto(`${ADMIN}/customers/${customer.id}`);
  await page.getByRole('button', { name: 'Send account link' }).click();
  await expect(page.getByText(`Account link sent to ${email}`)).toBeVisible();
  const log = await call(page, 'GET', '/notifications?limit=50');
  const msg = log.data.find((n: any) => n.template === 'portal_invitation' && n.recipient === email);
  const html: string = (await messageHtml(msg.id)).replace(/&#x3D;/g, '=').replace(/&amp;/g, '&');
  const token = new URL(/href="([^"]*\/account\/verify\?token=[\w-]+)"/.exec(html)![1]!).searchParams.get('token')!;

  const shopper = await (await browser.newContext()).newPage();
  const shopperErrors = collectErrors(shopper);
  await shopper.goto(`${STORE}/account/verify?token=${token}`);
  await hydrated(shopper);
  await shopper.getByRole('button', { name: 'Sign in' }).click();
  // The sign-in is a full round trip; it can be slow while the whole suite runs.
  await expect(shopper).toHaveURL(/\/account$/, { timeout: 20_000 });
  await hydrated(shopper);
  const owing = shopper.getByTestId('account-owing');
  await expect(owing).toContainText(`Booking #${order.number}`);
  // The test shop takes no online payments: the customer is told how to pay instead.
  await owing.getByRole('button', { name: /^Pay / }).click();
  await expect(owing.getByRole('alert')).toContainText('does not take payments online');

  const insurance = shopper.getByTestId('account-insurance');
  await insurance.getByRole('button', { name: 'Upload' }).click();
  await expect(insurance.getByText('Choose a file to upload')).toBeVisible();
  await insurance.getByLabel('Description (optional)').fill('Liability policy 2026');
  await insurance.getByLabel('File (PDF or photo)').setInputFiles({ name: 'policy.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await insurance.getByRole('button', { name: 'Upload' }).click();
  await expect(insurance.getByText('Liability policy 2026')).toBeVisible();
  await shopper.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page: shopper }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="account-extra"]').analyze();
  expect(axe.violations).toEqual([]);
  expect((await call(page, 'GET', `/customers/${customer.id}/attachments`)).data.map((a: any) => [a.kind, a.label])).toEqual([['insurance', 'Liability policy 2026']]);
  await shopper.context().close();
  await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
  expect(errors).toEqual([]);
  expect(shopperErrors.filter((e) => !/409/.test(e))).toEqual([]);
});
