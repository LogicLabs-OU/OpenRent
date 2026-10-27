import { expect } from '@playwright/test';
import { test, collectErrors, hydrated, localInput, randomOffset, shot, weekday } from './helpers.ts';

const WIDGET = process.env.WIDGET_URL ?? 'http://localhost:7073';

test('the embedded widget prices a booking and hands it to the storefront cart', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(WIDGET);
  const widget = page.locator('openrent-product');
  await expect(widget.getByText('Sea kayak')).toBeVisible();
  // It wears the live storefront theme (FR-THM-10), whichever theme that is.
  await expect.poll(() => widget.evaluate((el) => el.shadowRoot?.querySelector('style[data-openrent-theme]')?.textContent ?? '')).toContain('--radius:');
  const start = randomOffset() * 24 * 60;
  await widget
    .getByLabel('Pickup')
    .fill(localInput('Europe/Tallinn', start).replace(/T\d\d:\d\d$/, 'T10:00'));
  await widget
    .getByLabel('Return')
    .fill(localInput('Europe/Tallinn', start + 1440).replace(/T\d\d:\d\d$/, 'T16:00'));
  await expect(widget.getByText('Total')).toBeVisible();
  await shot(page, 'widget');
  await widget.getByRole('button', { name: 'Book now' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await hydrated(page);
  await expect(page.getByTestId('cart-lines')).toContainText('Sea kayak');
  expect(errors).toEqual([]);
});

test('a category embed books inside the widget and shows the booking on return from payment', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(WIDGET);
  const category = page.locator('openrent-category');
  // The seeded city bike: other specs add products to the shop, so the first card varies.
  const card = category.locator('[data-product="city-bike"]');
  await expect(card.getByRole('button', { name: 'Book now' })).toBeVisible();
  await card.getByRole('button', { name: 'Book now' }).click();

  const drawer = page.locator('openrent-checkout');
  await expect(drawer.getByLabel('Pickup')).toBeVisible();
  // A weekday, so the return the next day is not on a Sunday (the demo shop is closed then).
  const start = Math.round((Date.parse(`${weekday(randomOffset())}T12:00:00Z`) - Date.now()) / 60_000);
  await drawer.getByLabel('Pickup').fill(localInput('Europe/Tallinn', start).replace(/T\d\d:\d\d$/, 'T10:00'));
  await drawer.getByLabel('Return').fill(localInput('Europe/Tallinn', start + 1440).replace(/T\d\d:\d\d$/, 'T16:00'));
  await expect(drawer.getByTestId('checkout-total')).toBeVisible();
  await drawer.getByLabel('Name').fill('Widget Customer');
  await drawer.getByLabel('Email').fill(`widget-${Date.now()}@example.com`);
  // Without the terms the order is refused next to the checkbox.
  await drawer.getByRole('button', { name: /^Book/ }).click();
  await expect(drawer.getByText('Accept the terms to continue')).toBeVisible();
  await drawer.getByLabel('I accept the rental terms').check();
  await shot(page, 'widget-checkout');
  await drawer.getByRole('button', { name: /^Book/ }).click();
  const done = drawer.getByTestId('checkout-done');
  await expect(done).toContainText(/Booking #\d+/);
  const number = (await done.textContent())!.match(/#(\d+)/)![1];

  // Coming back from a payment page: the order named in the URL is shown over the page.
  const link = await done.getByRole('link', { name: 'View booking' }).getAttribute('href');
  const token = link!.split('/order/')[1];
  const order = await (await page.request.get(`${process.env.OPENRENT_API_URL ?? 'http://localhost:7170'}/api/v1/storefront/orders/${token}?token=${token}`, { headers: { 'X-Tenant-Slug': 'demo' } })).json();
  await page.goto(`${WIDGET}/?openrent_order=${order.id}&openrent_token=${token}&openrent_paid=1`);
  const back = page.locator('openrent-checkout').getByTestId('checkout-done');
  await expect(back).toContainText(`Booking #${number}`);
  await expect(back).toContainText('your payment went through');
  await page.locator('openrent-checkout').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('openrent-checkout')).toHaveCount(0);
  await expect(page).not.toHaveURL(/openrent_order/);
  expect(errors).toEqual([]);
});
