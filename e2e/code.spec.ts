import { expect } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, shot, signIn } from './helpers.ts';

test('staff add custom CSS and header HTML; unsafe parts are removed', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/themes`);
  await page.getByTestId('custom-code').getByRole('button', { name: 'Edit code' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('CSS').fill('.e2e-promo { color: rgb(200, 0, 0); }');
  await sheet
    .getByLabel('Header HTML')
    .fill('<p class="e2e-promo" onclick="alert(1)">Summer sale on kayaks</p><script>alert(1)</script>');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByText(/Some HTML was removed/)).toBeVisible();
  await expect(sheet.getByLabel('Header HTML')).toHaveValue('<p class="e2e-promo">Summer sale on kayaks</p>');
  await shot(page, 'admin-custom-code');

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(STORE);
  const promo = shopper.locator('[data-slot="header.after"] .e2e-promo');
  await expect(promo).toHaveText('Summer sale on kayaks');
  await expect(promo).toHaveCSS('color', 'rgb(200, 0, 0)');
  expect(await shopper.locator('[data-slot="header.after"] script').count()).toBe(0);

  // Clean up so other tests see the plain storefront.
  await sheet.getByLabel('CSS').fill('');
  await sheet.getByLabel('Header HTML').fill('');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Custom code saved' }).last(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
