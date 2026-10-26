import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, randomOffset, shot, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;
const day = 86400_000;

/** Calls the API with the signed-in staff session (CSRF header included). */
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

test('a customer signs in by email link, asks to cancel and staff approve', async ({
  page,
  browser,
}, info) => {
  const errors = collectErrors(page);
  await signIn(page);

  // A booking made online with the customer's email.
  const email = `acct-${Date.now()}@example.com`;
  // A weekday start, so pickup and return (the next day) fall on opening days (the demo shop closes on Sundays).
  const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
  const end = new Date(start.getTime() + day);
  const settings = await call(page, 'GET', '/storefront/settings');
  const catalog = await call(
    page,
    'GET',
    `/storefront/catalog/products?from=${start.toISOString()}&to=${end.toISOString()}&limit=100`,
  );
  const variant = catalog.data
    .flatMap((p: any) => p.variants)
    .find((v: any) => v.price && (v.available ?? 1) > 0);
  const cart = await call(page, 'POST', '/storefront/checkout_sessions', {
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    lines: [{ variant_id: variant.id, quantity: 1 }],
  });
  const done = await call(page, 'POST', `/storefront/checkout_sessions/${cart.id}/actions/complete`, {
    customer: { name: 'Ada Account', email },
    terms_accepted: true,
    terms_hash: settings.terms.hash,
  });
  const order = done.order;

  // The customer asks for a sign-in link.
  const customer = await (await browser.newContext({ viewport: page.viewportSize() ?? undefined })).newPage();
  await customer.goto(`${STORE}/account`);
  await expect(customer).toHaveURL(/\/account\/login$/);
  await hydrated(customer);
  await customer.getByLabel('Email').fill(email);
  await customer.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(customer.getByText('Check your inbox')).toBeVisible();
  await shot(customer, `sf-account-login-${info.project.name}`);

  // Staff can read the queued message; the link is in its HTML.
  const log = await call(page, 'GET', '/notifications?limit=50');
  const msg = log.data.find((n: any) => n.template === 'customer_login' && n.recipient === email);
  expect(msg).toBeTruthy();
  const html: string = (await call(page, 'GET', `/notifications/${msg.id}`)).body_html
    .replace(/&#x3D;/g, '=')
    .replace(/&amp;/g, '&');
  const link = /href="([^"]*\/account\/verify\?token=[\w-]+)"/.exec(html)![1]!;
  const token = new URL(link).searchParams.get('token')!;

  // Opening the link shows a button; only the click signs in.
  await customer.goto(`${STORE}/account/verify?token=${token}`);
  await hydrated(customer);
  await customer.getByRole('button', { name: 'Sign in' }).click();
  await expect(customer).toHaveURL(/\/account$/);
  await hydrated(customer);
  await expect(customer.getByRole('heading', { name: 'Your bookings' })).toBeVisible();
  const card = customer.getByTestId('account-order').filter({ hasText: `Booking #${order.number}` });
  await expect(card).toBeVisible();
  await expect(customer.getByRole('link', { name: 'Account' })).toBeVisible();

  await card.getByRole('button', { name: 'Request cancellation' }).click();
  await customer.getByLabel('Reason (optional)').fill('Our trip moved to next month');
  await customer.getByRole('button', { name: 'Send request' }).click();
  await expect(card.getByText('Cancellation requested')).toBeVisible();
  await shot(customer, `sf-account-${info.project.name}`);

  // Staff approve it on the order page.
  await page.goto(`${ADMIN}/orders/${order.id}`);
  const alert = page.getByTestId('cancellation-request');
  await expect(alert).toContainText('Our trip moved to next month');
  await shot(page, 'admin-cancellation-request');
  await alert.getByRole('button', { name: 'Approve and cancel' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve and cancel' }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'the booking is cancelled' }),
  ).toBeVisible();
  await expect(alert).toHaveCount(0);

  await customer.reload();
  await hydrated(customer);
  await expect(
    customer.getByTestId('account-order').filter({ hasText: `Booking #${order.number}` }),
  ).toContainText('Cancelled');

  await customer.getByRole('button', { name: 'Sign out' }).click();
  await expect(customer.getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect(errors).toEqual([]);
});
