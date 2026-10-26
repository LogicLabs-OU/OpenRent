import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

// Abandoned-cart reminders (FR-SF-9): the shop turns them on; a link from an old email says it expired.
test('staff turn cart reminders on, and an expired reminder link is explained on the storefront', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=payments`);
  try {
    await page.getByLabel('Cart reminders').click();
    await expect(page.getByLabel('Hours after the cart was left')).toHaveValue('4');
    await page.getByLabel('Hours after the cart was left').fill('6');
    await page.getByLabel('Hours after the cart was left').press('Tab');
    await expect.poll(async () => (await call(page, 'GET', '/tenant/settings')).cart_reminders).toEqual({ enabled: true, after_hours: 6 });
  } finally {
    await call(page, 'PATCH', '/tenant/settings', { cart_reminders: { enabled: false, after_hours: 4 } });
  }
  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(`${STORE}/cart/restore?token=v1.not.a.real-token`);
  await hydrated(shopper);
  await expect(shopper).toHaveURL(/\/cart$/);
  await expect(shopper.getByText('This link has expired.')).toBeVisible();
  await shopper.goto(`${STORE}/cart/stop-reminders?token=v1.not.a.real-token`);
  await expect(shopper.getByText('This link has expired.')).toBeVisible();
  await shopper.context().close();
  expect(errors).toEqual([]);
});
