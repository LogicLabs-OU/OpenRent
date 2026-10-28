import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'DELETE', path: string) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, headers: { 'x-csrf-token': csrf } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

async function serious(page: Page, include: string) {
  await page.mouse.move(0, 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(include).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);
}

test('the owner makes a database login for a BI tool, gives it a new password and revokes it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  // Logins an interrupted earlier run left behind would count towards the shop's five.
  for (const l of (await call(page, 'GET', '/bi_access')).data) if (/^E2E /.test(l.name)) await call(page, 'DELETE', `/bi_access/${l.id}`);

  await page.goto(`${ADMIN}/settings?tab=data_access`);
  const card = page.getByTestId('data-access');
  await expect(card.getByTestId('data-access-connection')).toContainText('bi.orders');
  await expect(card.getByTestId('data-access-connection')).toContainText('127.0.0.1');
  expect(await serious(page, '[data-testid="data-access"]'), 'data access card').toEqual([]);

  await card.getByRole('button', { name: 'New login' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('Give the login a name')).toBeVisible();
  const name = `E2E Metabase ${Date.now() % 100000}`;
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  const username = await dialog.getByTestId('data-access-username').inputValue();
  const password = await dialog.getByTestId('data-access-password').inputValue();
  expect(username).toMatch(/^openrent_bi_[0-9a-f]{12}$/);
  expect(password.length).toBeGreaterThanOrEqual(30);
  expect(await serious(page, '[role="dialog"]'), 'password dialog').toEqual([]);
  await shot(page, 'admin-data-access-login');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The password is not shown again.
  const row = card.getByTestId('data-access-login').filter({ hasText: name });
  await expect(row).toContainText(username);
  await expect(card).not.toContainText(password);

  await row.getByRole('button', { name: 'New password' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'New password' }).click();
  const next = await dialog.getByTestId('data-access-password').inputValue();
  expect(next).not.toBe(password);
  await dialog.getByRole('button', { name: 'Done' }).click();

  await row.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Login revoked' }).last()).toBeVisible();
  await expect(row).toBeHidden();
  expect(errors).toEqual([]);
});
