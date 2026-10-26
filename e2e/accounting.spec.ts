import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { startXeroFake, xeroOrg, type XeroFake } from '../packages/accounting-fakes/src/index.ts';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json().catch(() => null);
}

/** Leaves the shop without an accounting connection and with the default settings. */
async function reset(page: Page) {
  if (await call(page, 'GET', '/accounting/connection')) await call(page, 'DELETE', '/accounting/connection');
  await call(page, 'PATCH', '/accounting/settings', { invoice_when: 'manual', locked_until: null });
  await call(page, 'POST', '/accounting/systems/xero/app', { config: { client_id: null, client_secret: null, api_base_url: null, auth_base_url: null } });
}

let fake: XeroFake;
test.beforeAll(async () => {
  // The demo shop charges Estonian VAT (24 %), so its Xero organisation has that rate too.
  const events = xeroOrg('Kayak Hire Events Ltd');
  events.taxRates.push({ TaxType: 'OUTPUT3', Name: '24% (VAT on Income)', EffectiveRate: 24, Status: 'ACTIVE' });
  fake = await startXeroFake({ orgs: [xeroOrg(), events] });
});
test.afterAll(async () => fake?.close());

// Xero here is a local stand-in that keeps Xero's rules (packages/accounting-fakes).
test('staff connect Xero, map accounts from Xero’s lists, start sending and see what reached the books', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await reset(page);
  try {
    await call(page, 'POST', '/accounting/systems/xero/app', { config: { client_id: 'xero-client', client_secret: 'xero-secret', api_base_url: fake.url, auth_base_url: fake.url } });

    await page.getByRole('link', { name: 'Accounting' }).first().click();
    await expect(page.getByTestId('accounting-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Set up' }).click();
    await page.getByRole('radio', { name: /Xero/ }).click();
    await expect(page.getByLabel('Redirect URL')).toHaveValue(/\/api\/v1\/integrations\/oauth\/callback$/);
    await page.getByRole('button', { name: 'Sign in with Xero' }).click();

    // Back from Xero's sign-in: choose the organisation, then the accounts.
    await expect(page.getByText('Connected. Now choose the accounts.')).toBeVisible();
    await page.getByLabel('Organisation', { exact: true }).selectOption({ label: 'Kayak Hire Events Ltd' });
    const mapping = page.getByTestId('accounting-mapping');
    await expect(mapping.getByLabel(/Rental revenue/)).toBeVisible();
    await page.getByRole('button', { name: 'Start sending' }).click();
    await expect(mapping.getByText('Choose one').first()).toBeVisible();

    await mapping.getByLabel(/Rental revenue/).selectOption({ label: '201 — Rental Income' });
    await mapping.getByLabel(/Other revenue/).selectOption({ label: '260 — Other Revenue' });
    await mapping.getByLabel(/Deposits held/).selectOption({ label: '835 — Customer Deposits' });
    await mapping.getByLabel(/Bank transfers go to/).selectOption({ label: '090 — Business Bank Account' });
    await expect(mapping.getByLabel('24 % tax')).toHaveValue('OUTPUT3');
    await mapping.getByLabel('0 % tax').selectOption({ label: 'No VAT' });
    await mapping.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();
    await shot(page, 'admin-accounting-setup');
    await page.getByRole('button', { name: 'Start sending' }).click();
    await expect(page.getByTestId('accounting-sending')).toBeVisible();

    // A booking's invoice is booked at once and waits to be sent (the worker sends it within a minute).
    const c = await call(page, 'POST', '/customers', { name: 'Books Customer', email: `books-${Date.now()}@example.com` });
    const product = await call(page, 'POST', '/products', { type: 'rental', name: `Books kayak ${Date.now()}`, visibility: 'hidden', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
    const start = new Date(Date.now() + 40 * 86400_000);
    const o = await call(page, 'POST', '/orders', { customer_id: c.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
    const invoice = await call(page, 'POST', `/orders/${o.id}/documents`, { type: 'invoice' });

    await page.getByRole('tab', { name: 'Records' }).click();
    const row = page.getByTestId('accounting-record').filter({ hasText: invoice.number });
    await expect(row).toContainText('Waiting');
    await shot(page, 'admin-accounting-records');
    await row.getByRole('button', { name: /Actions for entry/ }).click();
    await page.getByRole('menuitem', { name: 'Mark as handled by hand' }).click();
    await page.getByRole('dialog').getByLabel('Note').fill('Booked by our accountant');
    await page.getByRole('dialog').getByRole('button', { name: 'Mark as handled by hand' }).click();
    await expect(row).toContainText('Handled by hand');

    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByLabel('Issue the invoice').selectOption({ label: 'When a booking is confirmed' });
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect.poll(async () => (await call(page, 'GET', '/tenant/settings')).accounting.invoice_when).toBe('reserved');

    await page.getByRole('tab', { name: 'Journal' }).click();
    const download = page.waitForEvent('download');
    await page.getByTestId('journal-export').getByRole('button', { name: 'Export CSV' }).click();
    expect(readFileSync(await (await download).path(), 'utf8').split('\n')[0]).toContain('number');

    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByTestId('accounting-stats')).toContainText('Kayak Hire Events Ltd');
    await shot(page, 'admin-accounting-overview');
  } finally {
    await reset(page);
  }
  expect(errors).toEqual([]);
});
