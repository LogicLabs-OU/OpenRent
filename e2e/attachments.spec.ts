import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff attach a file to a booking and share it with the customer', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const kayak = (await call(page, 'GET', '/products?q=Sea%20kayak')).data.find((p: { name: string }) => p.name === 'Sea kayak');
  const customer = await call(page, 'POST', '/customers', { name: 'Ada Attach', email: `att-${Date.now()}@example.com` });
  const starts = new Date(Date.now() + 50 * 86400_000);
  const order = await call(page, 'POST', '/orders', {
    customer_id: customer.id,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 86400_000).toISOString(),
    lines: [{ variant_id: kayak.variants[0].id, quantity: 1 }],
  });

  await page.goto(`${ADMIN}/orders/${order.id}`);
  const card = page.getByTestId('attachments');
  await card.getByTestId('attachment-input').setInputFiles({ name: 'Route map.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF\n') });
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'File attached' }).last()).toBeVisible();
  await expect(card.getByLabel('File name shown')).toHaveValue('Route map.pdf');
  await card.getByRole('switch').click();
  await expect.poll(async () => (await call(page, 'GET', `/orders/${order.id}/attachments`)).data[0].visibility).toBe('customer');
  await shot(page, 'admin-order-attachments');

  // The customer sees it on the order page from the confirmation email.
  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(`${STORE}/order/${order.public_token}`);
  await hydrated(shopper);
  const link = shopper.getByRole('link', { name: 'Route map.pdf' });
  await expect(link).toBeVisible();
  const download = await shopper.request.get(`${STORE}${await link.getAttribute('href')}`);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toBe('application/pdf');
  expect(errors).toEqual([]);
});
