import { expect, test } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

test('staff edit a document template with a live preview, then go back to the built-in one', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=documents`);
  const row = page.getByTestId('document-template-row').filter({ hasText: 'Delivery note' });
  await row.getByRole('button', { name: 'Edit' }).click();
  const sheet = page.getByRole('dialog');
  const preview = sheet.getByTestId('document-preview');
  await expect(preview).toBeVisible();
  const marker = `Handle with care ${Date.now() % 10000}`;
  const body = sheet.getByLabel('Template', { exact: true });
  await body.fill(`${await body.inputValue()}<p class="care">${marker}</p>`);
  await expect.poll(async () => (await preview.getAttribute('srcdoc')) ?? '').toContain(marker);
  // A broken template is explained next to the text.
  await body.fill(`${await body.inputValue()}{{#if}}`);
  await expect(sheet.getByText(/does not compile/)).toBeVisible();
  await body.fill((await body.inputValue()).replace('{{#if}}', ''));
  await expect(sheet.getByText(/does not compile/)).toHaveCount(0);
  await shot(page, 'admin-document-template');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Template saved' }).last()).toBeVisible();
  await expect(row).toContainText('Customised');

  await row.getByRole('button', { name: 'Use built-in' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Use built-in' }).click();
  await expect(row).toContainText('Built-in');
  expect(errors).toEqual([]);
});
