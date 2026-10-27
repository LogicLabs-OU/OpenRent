import { expect } from '@playwright/test';
import { test, ADMIN, addProduct, collectErrors, localInput, shot } from './helpers.ts';

test('staff run an order from creation to return', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL ?? 'owner@example.com');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? 'openrent');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await shot(page, 'admin-dashboard');

  await page.getByRole('link', { name: 'Orders' }).first().click();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await shot(page, 'admin-orders');

  // New order: customer, product, create and reserve.
  await page.goto(`${ADMIN}/orders/new`);
  await page.getByLabel('Search by name, email or phone').fill('Novak');
  await page.getByRole('button', { name: /Tom Novak/ }).click();
  // A counter rental starting now: pickup in a few minutes, return later today (shop time zone).
  await page.getByLabel(/^Pickup/).fill(localInput('Europe/Tallinn', 2));
  await page.getByLabel(/^Return/).fill(localInput('Europe/Tallinn', 300));
  await addProduct(page, 'Sea kayak');
  await expect(page.getByText('Total').first()).toBeVisible();
  await shot(page, 'admin-new-order');
  await page.getByRole('button', { name: /create and reserve/i }).click();
  await expect(page.getByRole('heading', { name: /Order #\d+/ })).toBeVisible();
  await expect(page.getByText('Reserved').first()).toBeVisible();

  // Assign a unit by scanning, pick up, check in, inspect.
  const scan = page.getByLabel('Barcode');
  let assigned = false;
  for (const code of ['KY-004', 'KY-003', 'KY-002', 'KY-001']) {
    await scan.fill(code);
    await scan.press('Enter');
    const msg = page.getByRole('status').filter({ hasText: code });
    await expect(msg).toBeVisible();
    if ((await msg.textContent())?.includes('assigned')) {
      assigned = true;
      break;
    }
  }
  expect(assigned).toBe(true);
  await shot(page, 'admin-order-assigned');
  await page.getByRole('button', { name: 'Mark picked up' }).click();
  await expect(page.getByText('Out', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Check in' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText('Returned', { exact: true }).first()).toBeVisible();
  await shot(page, 'admin-order-returned');

  await page.goto(`${ADMIN}/products`);
  await page.getByLabel('Search products').fill('Sea kayak');
  await expect(page.getByRole('link', { name: 'Sea kayak' })).toBeVisible();
  await page.getByRole('link', { name: 'Sea kayak' }).click();
  await expect(page.getByText('Availability', { exact: true })).toBeVisible();
  await shot(page, 'admin-product');
  await page.goto(`${ADMIN}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(errors).toEqual([]);
});
