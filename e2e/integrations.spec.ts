import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// The fixture plugin e2e/fixtures/plugins/e2e-extras adds "Ledger", which connects with an API key.
test('staff connect an integration, send earlier invoices, read the log and disconnect', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  // A run that stopped half way may have left Ledger connected.
  const before = (await call(page, 'GET', '/integrations')).data.find((i: any) => i.id === 'e2e-ledger');
  if (before.connection) await call(page, 'DELETE', `/integration_connections/${before.connection.id}`);

  await page.goto(`${ADMIN}/integrations`);
  // Accounting systems have their own page now.
  await expect(page.locator('[data-integration="xero"]')).toHaveCount(0);
  await expect(page.getByTestId('accounting-link')).toBeVisible();
  // OAuth integrations not connected yet show what to enter as the redirect URL at the provider.
  await expect(page.getByTestId('integration-redirect').first()).toContainText('/api/v1/integrations/oauth/callback');

  const ledger = page.locator('[data-integration="e2e-ledger"]');
  await ledger.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Ledger' });
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByText('Fill this in')).toBeVisible();
  await dialog.getByLabel('API key').fill('wrong-key');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByText(/Unknown API key/)).toBeVisible();
  await dialog.getByLabel('API key').fill('ledger-key');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog).toBeHidden();
  await expect(ledger.getByText('Connected', { exact: true })).toBeVisible();
  await expect(ledger.getByText('Account: E2E Ledger')).toBeVisible();
  await shot(page, 'admin-integrations');

  try {
    await ledger.getByRole('button', { name: 'Manage' }).click();
    const sheet = page.getByRole('dialog', { name: 'Ledger' });
    await sheet.getByLabel('Journal name').fill('Rentals');
    await sheet.getByRole('button', { name: 'Save' }).click();
    const conn = (await call(page, 'GET', '/integrations')).data.find((i: any) => i.id === 'e2e-ledger').connection;
    await expect.poll(async () => (await call(page, 'GET', `/integration_connections/${conn.id}`)).settings.journal).toBe('Rentals');

    // Invoices issued before connecting go across on request.
    await sheet.getByLabel('Since').fill('2000-01-01');
    await sheet.getByRole('button', { name: 'Send earlier records' }).click();
    await expect(page.getByText(/records? queued/)).toBeVisible();
    const log = sheet.getByTestId('integration-log');
    await expect(log.getByText(/^(document.issued|payment.succeeded)$/).first()).toBeVisible();
    await expect(log.getByText('Waiting').first()).toBeVisible();
    await shot(page, 'admin-integration-sheet');

    await sheet.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Ledger disconnected')).toBeVisible();
    await expect(ledger.getByRole('button', { name: 'Connect' })).toBeEnabled();
  } finally {
    const after = (await call(page, 'GET', '/integrations')).data.find((i: any) => i.id === 'e2e-ledger');
    if (after.connection) await call(page, 'DELETE', `/integration_connections/${after.connection.id}`);
  }
  expect(errors).toEqual([]);
});

test('staff set account codes and download the accounting journal', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const saved = (await call(page, 'GET', '/tenant/settings')).accounting.accounts;
  await page.goto(`${ADMIN}/accounting?tab=journal`);
  const card = page.getByTestId('journal-export');
  const rental = page.getByLabel('Rental revenue', { exact: true });
  try {
    await expect(rental).not.toHaveValue('');
    await rental.fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(rental).toHaveAttribute('aria-invalid', 'true');
    await rental.fill('4100');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await call(page, 'GET', '/tenant/settings')).accounting.accounts.revenue_rental).toBe('4100');

    await card.getByLabel('From').fill('2000-01-01');
    const download = page.waitForEvent('download');
    await card.getByRole('button', { name: 'CSV' }).click();
    const csv = readFileSync(await (await download).path(), 'utf8');
    expect(csv.split('\n')[0]).toMatch(/date/i);
    await shot(page, 'admin-journal-export');
  } finally {
    await call(page, 'PATCH', '/accounting/settings', { accounts: saved });
  }
  expect(errors).toEqual([]);
});
