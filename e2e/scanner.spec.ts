import { expect, test } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

test('staff teach the admin how this scanner types, and scans use it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/scan`);
  await page.getByTestId('scanner-setup').click();
  const dialog = page.getByRole('dialog', { name: 'Set up scanner' });
  await expect(dialog.getByText('Scan a barcode now')).toBeVisible();
  // A scanner that adds "]C1" before and "#" after the code, and ends with Tab.
  await page.keyboard.type(']C1TEST1234#', { delay: 5 });
  await page.keyboard.press('Tab');
  await dialog.getByTestId('scanner-expected').fill('TEST1234');
  const detected = dialog.getByTestId('scanner-detected');
  await expect(detected).toContainText(']C1');
  await expect(detected).toContainText('#');
  await expect(detected).toContainText('Tab');
  await shot(page, 'admin-scanner-setup');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  // The next scan arrives with the same extras; the code is looked up without them.
  await page.keyboard.type(']C1NOPE9876#', { delay: 5 });
  await page.keyboard.press('Tab');
  await expect(page.getByText('NOPE9876').first()).toBeVisible();
  await expect(page.getByText(']C1NOPE9876')).toHaveCount(0);

  // The back office registers its offline shell.
  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
  expect(scope).toMatch(/\/admin\/$/);
  expect(errors).toEqual([]);
});
