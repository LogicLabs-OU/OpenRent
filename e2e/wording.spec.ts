import { expect, test } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

test('staff reword a storefront text, see it live and restore the original', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=translations`);
  const card = page.getByTestId('string-overrides');
  await card.getByLabel('Texts of').selectOption({ label: 'Theme: OpenRent Default' });
  await card.getByLabel('Language', { exact: true }).selectOption('en');
  await card.getByRole('textbox', { name: 'Search texts' }).fill('All products');
  const row = card.locator('[data-testid="string-row"][data-key="nav.all"]');
  await expect(row).toBeVisible();

  // A placeholder-free text accepts anything; the API refuses changed placeholders elsewhere.
  await row.getByRole('textbox').fill('Everything we rent');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.getByText('Changed')).toBeVisible();
  await shot(page, 'admin-wording');

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(STORE);
  await hydrated(shopper);
  await expect(shopper.getByRole('link', { name: 'Everything we rent' }).first()).toBeVisible();

  await row.getByRole('button', { name: 'Original' }).click();
  await expect(row.getByText('Changed')).toHaveCount(0);
  await shopper.reload();
  await hydrated(shopper);
  await expect(shopper.getByRole('link', { name: 'Everything we rent' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
