import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff set the invoice details, a company asks for e-arve, and its invoice comes as an e-invoice', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;

  // Invoice details: a wrong IBAN is told at the field.
  await page.goto(`${ADMIN}/settings`);
  const card = page.getByTestId('settings-invoicing');
  await card.getByLabel('Registry code').fill('10002345');
  await card.getByLabel('IBAN').fill('EE38 2200 2210 2014 5684');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Enter a valid IBAN')).toBeVisible();
  await card.getByLabel('IBAN').fill('EE38 2200 2210 2014 5685');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();
  await expect(card.getByText('Enter a valid IBAN')).toHaveCount(0);

  // The company's billing details ask for e-arve.
  const customer = await call(page, 'POST', '/customers', { type: 'company', name: `E-invoice ${stamp}`, company_name: `Arve ${stamp} OÜ`, email: `arve-${stamp}@example.com` });
  await page.goto(`${ADMIN}/customers/${customer.id}`);
  const billing = page.getByTestId('customer-billing');
  await billing.getByRole('button', { name: 'Add' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bill to').selectOption('company');
  await dialog.getByLabel('Contact person').fill('Mari Maasikas');
  await dialog.getByLabel('Company').fill(`Arve ${stamp} OÜ`);
  await dialog.locator('#bd-line1').fill('Pärnu mnt 10');
  await dialog.locator('#bd-city').fill('Tallinn');
  await dialog.locator('#bd-country').fill('EE');
  await dialog.getByLabel('E-invoices').selectOption({ label: 'Estonian e-invoice (e-arve)' });
  await page.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[role="dialog"]').analyze();
  expect(axe.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(billing).toContainText(`Arve ${stamp} OÜ`);

  // Its invoice has an e-invoice to download from the order page.
  const product = (await call(page, 'GET', '/products?q=Sea%20kayak')).data[0];
  const starts = new Date(Date.now() + 20 * 86400_000);
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });
  try {
    const invoice = await call(page, 'POST', `/orders/${order.id}/documents`, { type: 'invoice' });
    expect(invoice.einvoice_format).toBe('earve');
    await page.goto(`${ADMIN}/orders/${order.id}`);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download the e-invoice' }).click();
    const file = await download;
    const xml = readFileSync((await file.path())!, 'utf8');
    expect(xml).toContain('<E_Invoice');
    expect(xml).toContain('<PayToAccount>EE382200221020145685</PayToAccount>');
    await shot(page, 'admin-einvoice');
  } finally {
    await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
  }
  expect(errors).toEqual([]);
});
