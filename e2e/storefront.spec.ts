import { expect, test } from '@playwright/test';
import { STORE, collectErrors, hydrated, pickDay, randomOffset, shot, weekday } from './helpers.ts';

test('a customer books a bike online @mobile', async ({ page }, info) => {
  const errors = collectErrors(page);
  await page.goto(STORE);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, `sf-home-${info.project.name}`);

  // Dates first: the catalogue then shows live availability.
  const start = randomOffset();
  const bar = page.getByTestId('date-bar');
  await bar.locator('#or-dates').click();
  const calendar = page.locator('[data-slot="popover-content"]');
  await pickDay(calendar, weekday(start));
  await pickDay(calendar, weekday(start + 1));
  await expect(calendar).toBeHidden();
  await bar.getByRole('button', { name: /show what/i }).click();
  await expect(page.locator('[data-availability="ok"]').first()).toBeVisible();

  await page.getByTestId('product-card').filter({ hasText: 'Sea kayak' }).click();
  await expect(page.getByRole('heading', { name: 'Sea kayak' })).toBeVisible();
  await hydrated(page);
  await expect(page.getByTestId('price-total')).toBeVisible();
  await shot(page, `sf-product-${info.project.name}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.locator('p[role="status"]', { hasText: 'Added to your cart' })).toBeVisible();

  await page.goto(`${STORE}/cart`);
  await hydrated(page);
  await expect(page.getByTestId('cart-lines')).toContainText('Sea kayak');
  await shot(page, `sf-cart-${info.project.name}`);
  await page.getByRole('link', { name: /continue to checkout/i }).click();
  await page.waitForURL(/checkout/);
  await hydrated(page);

  await page.getByLabel('Full name').fill('Playwright Customer');
  await page.getByLabel('Email').fill(`pw-${Date.now()}@example.com`);
  await page.getByLabel('I accept the rental terms').check();
  await shot(page, `sf-checkout-${info.project.name}`);
  await page.getByRole('button', { name: /place booking/i }).click();
  // A full page load of the confirmation; the dev server can take a while under a parallel run.
  await expect(page.getByRole('heading', { name: /thank you, your booking #\d+/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('order-qr').locator('svg')).toBeVisible();
  await shot(page, `sf-confirmation-${info.project.name}`);
  expect(errors).toEqual([]);
});
