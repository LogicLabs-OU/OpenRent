import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown, ok = true) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  if (ok) expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res;
}

test('a shop turns memberships on, keeps a plan, adds a member and takes the fee at the counter', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const planName = `E2E Gold ${stamp}`;
  await call(page, 'PATCH', '/plugins/memberships', { enabled: true });
  // Shops' choices reach the plugin's routes within 15 seconds.
  await expect.poll(async () => (await call(page, 'GET', '/plugins/memberships/plans', undefined, false)).status(), { timeout: 25_000 }).toBe(200);
  const customer = await (await call(page, 'POST', '/customers', { name: `Member ${stamp}`, email: `member-${stamp}@example.com` })).json();
  try {
    // Plans: drawn by the admin on the plugins page.
    await page.goto(`${ADMIN}/plugins`);
    const plans = page.getByTestId('plugin-page-memberships-plans');
    await expect(plans.getByText('Membership plans')).toBeVisible();
    await plans.getByRole('button', { name: 'Add' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Fee before tax').fill('10');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByText('Enter a name')).toBeVisible();
    await form.getByLabel('Name', { exact: true }).fill(planName);
    await form.getByLabel('Member discount (%)').fill('50');
    await form.getByLabel('Items a member may have at once').fill('2');
    await form.getByLabel('Show in the shop’s plan list').check();
    await page.mouse.move(0, 0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[role="dialog"]').analyze();
    expect(axe.violations).toEqual([]);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(plans.getByRole('cell', { name: planName, exact: true })).toBeVisible();
    await expect(plans.getByRole('row').filter({ hasText: planName })).toContainText('50 %');

    // A member on the customer's page: the first fee is an invoice of its own.
    await page.goto(`${ADMIN}/customers/${customer.id}`);
    const membership = page.getByTestId('plugin-page-memberships-members');
    await expect(membership.getByText('Not a member.')).toBeVisible();
    await membership.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('dialog').getByLabel('Plan').selectOption({ label: `${planName}: €10.00 a month` });
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(membership.getByRole('row').filter({ hasText: planName })).toContainText('Waiting for payment');
    const invoices = page.getByTestId('customer-invoices');
    await expect(invoices.getByText(/owed/)).toBeVisible();
    await page.mouse.move(0, 0);
    const axe2 = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="plugin-page-memberships-members"]').include('[data-testid="customer-invoices"]').analyze();
    expect(axe2.violations).toEqual([]);
    await shot(page, 'admin-membership');

    // Paid at the counter.
    await invoices.getByRole('button', { name: /^Actions for invoice/ }).click();
    await page.getByRole('menuitem', { name: 'Record payment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Payment recorded' })).toBeVisible();
    await expect(invoices.getByText('Paid', { exact: true })).toBeVisible();
  } finally {
    const members = await (await call(page, 'GET', `/plugins/memberships/members?customer_id=${customer.id}`)).json();
    for (const m of members.data) if (m.status !== 'cancelled') await call(page, 'POST', `/plugins/memberships/members/${m.id}/actions/cancel`, {}, false);
    const all = await (await call(page, 'GET', '/plugins/memberships/plans')).json();
    for (const p of all.data) if (p.name === planName) await call(page, 'DELETE', `/plugins/memberships/plans/${p.id}`, undefined, false);
    await call(page, 'PATCH', '/plugins/memberships', { enabled: false });
  }
  expect(errors).toEqual([]);
});
