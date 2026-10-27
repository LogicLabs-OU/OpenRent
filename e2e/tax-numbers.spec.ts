import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startViesFake, type ViesFake } from '@openrent/tax-fakes';
import { test, ADMIN, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// VIES here is a local stand-in (packages/tax-fakes).
let vies: ViesFake;
test.beforeAll(async () => {
  vies = await startViesFake();
});
test.afterAll(() => vies?.close());

test('staff see a customer’s VAT number checked and check it again', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const number = `DE${String(Date.now()).slice(-9)}`;
  vies.numbers[number] = { name: 'Bühnentechnik GmbH', address: 'Hauptstr. 1\n10115 Berlin' };
  await call(page, 'PATCH', '/plugins/tax-vies', { enabled: true, config: { api_url: vies.url, requester_vat: 'EE100931558' } });
  try {
    const c = await call(page, 'POST', '/customers', { type: 'company', name: 'Bühnentechnik', company_name: 'Bühnentechnik GmbH', email: `pw-vat-${Date.now()}@example.com`, tax_id: number });
    await page.goto(`${ADMIN}/customers/${c.id}`);
    const check = page.getByTestId('tax-id-check');
    await expect(check).toContainText('Valid in the tax register');
    await expect(check).toContainText('Bühnentechnik GmbH');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="tax-id-check"]').analyze()).violations).toEqual([]);

    // The company closed: VIES no longer knows the number.
    delete vies.numbers[number];
    await check.getByRole('button', { name: 'Check again' }).click();
    await expect(check).toContainText('Not valid in the tax register');
  } finally {
    await call(page, 'PATCH', '/plugins/tax-vies', { enabled: false, config: { api_url: null, requester_vat: null } });
  }
  expect(errors).toEqual([]);
});

test('staff choose which notices go to Slack', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/plugins`);
  const card = page.getByTestId('plugin-card').filter({ hasText: 'Slack notices' });
  await card.getByRole('button', { name: 'Configure' }).click();
  const dialog = page.getByRole('dialog');
  // Every kind is on until the shop turns one off.
  await expect(dialog.getByLabel('Overdue returns')).toBeChecked();
  await dialog.getByLabel('Overdue returns').click();
  await dialog.getByLabel('Incoming webhook URL').fill('https://hooks.slack.com/services/T000/B000/e2etest');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  try {
    await card.getByRole('button', { name: 'Configure' }).click();
    await expect(dialog.getByLabel('Overdue returns')).not.toBeChecked();
    await expect(dialog.getByLabel('New bookings')).toBeChecked();
    await page.keyboard.press('Escape');
  } finally {
    await call(page, 'PATCH', '/plugins/notify-slack', { config: { webhook_url: null, kind_staff_overdue: null } });
  }
  expect(errors).toEqual([]);
});
