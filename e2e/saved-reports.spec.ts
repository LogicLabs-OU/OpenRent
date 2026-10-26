import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

// New reports (FR-REP-3) and saved, scheduled reports (FR-REP-4).
test('staff save a report with a relative period and have it emailed weekly', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  // Something the owner did, so the staff activity report has a row.
  await call(page, 'POST', '/customers', { name: `E2E Report ${stamp}`, email: `report-${stamp}@example.com` });

  await page.goto(`${ADMIN}/reports`);
  await page.getByLabel('Report').selectOption('staff_activity');
  await page.getByLabel('Period').selectOption('all_time');
  await expect(page.getByLabel('From', { exact: true })).toBeHidden();
  await expect(page.getByRole('columnheader', { name: 'Bookings created' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'owner@example.com' })).toBeVisible();
  await page.getByLabel('Group by').selectOption('action');
  await expect(page.getByRole('columnheader', { name: 'Record' })).toBeVisible();

  await page.getByRole('button', { name: 'Save report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save report' });
  const name = `Team week ${stamp}`;
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Email schedule').selectOption('weekly');
  await dialog.getByLabel('Recipients').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText('not-an-email is not an email address')).toBeVisible();
  await dialog.getByLabel('Recipients').fill('books@example.com');
  await dialog.getByLabel('File format').selectOption('xlsx');
  await page.mouse.move(0, 0);
  const inDialog = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[role="dialog"]').analyze();
  expect(inDialog.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByTestId('saved-report').filter({ hasText: name });
  await expect(row).toContainText('Weekly to 1 recipient');
  await expect(row).toContainText('Staff activity');
  await row.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('The report is on its way to 1 recipient')).toBeVisible();

  // Opening it brings its filters back.
  await page.getByLabel('Report').selectOption('revenue');
  await page.getByLabel('Period').selectOption('');
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByLabel('Report')).toHaveValue('staff_activity');
  await expect(page.getByLabel('Period')).toHaveValue('all_time');
  await expect(page.getByLabel('Group by')).toHaveValue('action');
  await expect(page.getByRole('button', { name: 'Update saved report' })).toBeVisible();
  const saved = (await call(page, 'GET', '/saved_reports?limit=100')).data.find((s: any) => s.name === name);
  expect(saved).toMatchObject({ report: 'staff_activity', format: 'xlsx', schedule: 'weekly', recipients: ['books@example.com'], params: { range: 'all_time', group_by: 'action' } });

  await page.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('main').analyze();
  expect(axe.violations).toEqual([]);

  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toBeHidden();
  expect(errors).toEqual([]);
});
