import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, ADMIN, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}
const axe = (page: Page, sel: string) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(sel).analyze();

// Moving to OpenRent (FR-MIG-2): a file with its own column names, and a move from Shelf.nu.
test('staff map a customer file’s columns and check a move from Shelf.nu', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();

  await page.goto(`${ADMIN}/customers`);
  await page.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import customers' });
  await dialog.getByTestId('import-input').setInputFiles({
    name: 'kunden.csv', mimeType: 'text/csv',
    // A column name of its own, so no mapping is remembered from an earlier run.
    buffer: Buffer.from(`Full Name,E-Mail,Kundennummer ${stamp}\nE2E Mapper ${stamp},mapper-${stamp}@example.com,K-${stamp}\n`),
  });
  const mapping = dialog.getByTestId('import-mapping');
  await expect(mapping).toBeVisible();
  await mapping.getByLabel(`What the column Kundennummer ${stamp} holds`).selectOption('reference');
  await mapping.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog.getByTestId('import-summary')).toContainText('1 new');
  // Buttons at rest (not still fading in from busy) for the colour check.
  await expect(mapping.getByRole('button', { name: 'Check again' })).toBeEnabled();
  await expect(dialog.getByTestId('import-apply')).toBeEnabled();
  await page.mouse.move(0, 0);
  expect((await axe(page, '[role="dialog"]')).violations).toEqual([]);
  await dialog.getByTestId('import-apply').click();
  await expect(dialog).toBeHidden();
  const found = (await call(page, 'GET', `/customers?q=${encodeURIComponent(`mapper-${stamp}@example.com`)}`)).data[0];
  expect(found).toMatchObject({ name: `E2E Mapper ${stamp}` });

  await page.goto(`${ADMIN}/settings?tab=import`);
  const card = page.getByTestId('migration');
  await card.getByRole('radio', { name: 'Shelf.nu' }).click();
  await card.getByLabel('Shelf.nu export (CSV)').setInputFiles({
    name: 'shelf.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`Name,Category,Valuation,QR code ID\nE2E Drone ${stamp},Aerial,900,qr-e2e-${stamp}-1\nE2E Drone ${stamp},Aerial,900,qr-e2e-${stamp}-2\n`),
  });
  await card.getByRole('button', { name: 'Read and check' }).click();
  const batch = page.getByTestId('migration-batch');
  await expect(batch).toContainText('Checked');
  await expect(batch.getByTestId('import-summary').first()).toContainText('1 new');
  await expect(batch.getByTestId('import-summary').nth(1)).toContainText('2 new');
  await page.mouse.move(0, 0);
  expect((await axe(page, '[data-testid="migration"], [data-testid="migration-batch"]')).violations).toEqual([]);
  await batch.getByTestId('migration-apply').click();
  // The worker brings it in; here it is queued.
  await expect(batch.locator('p[role="status"]')).toContainText('Bringing it in');
  expect(errors).toEqual([]);
});
