import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('an owner builds a role from the permission matrix, gives it to a new member and turns their access off', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const roleName = `Front desk ${stamp}`;
  const email = `pw-role-${stamp}@example.com`;
  let roleId: string | undefined;
  let userId: string | undefined;
  try {
    await page.goto(`${ADMIN}/settings?tab=team`);
    await page.getByRole('button', { name: 'New role' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Name').fill(roleName);
    const matrix = sheet.getByTestId('permission-matrix');
    await matrix.getByRole('row').filter({ hasText: 'Orders' }).getByLabel('View').check();
    await matrix.getByRole('row').filter({ hasText: 'Orders' }).getByLabel('Pick up and return').check();
    await matrix.getByRole('row').filter({ hasText: 'Customers' }).getByLabel('View').check();
    await shot(page, 'admin-roles');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('role-row').filter({ hasText: roleName })).toContainText('0 members');
    roleId = (await call(page, 'GET', '/roles')).data.find((r: any) => r.name === roleName).id;

    const add = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add member' }) });
    await add.getByLabel('Email', { exact: true }).fill(email);
    await add.getByLabel('Name', { exact: true }).fill('Desk Person');
    await add.getByLabel('Initial password').fill('desk-password');
    await add.getByLabel('Role', { exact: true }).selectOption({ label: roleName });
    await add.getByRole('button', { name: 'Add member' }).click();
    const row = page.getByTestId('member-row').filter({ hasText: email });
    await expect(row.getByLabel('Role of Desk Person')).toHaveValue(roleId);
    userId = (await call(page, 'GET', '/users')).data.find((u: any) => u.email === email).id;

    // The member sees what the role allows and nothing more.
    const member = await (await browser.newContext()).newPage();
    await member.goto(`${ADMIN}/login`);
    await member.getByLabel('Email').fill(email);
    await member.getByLabel('Password').fill('desk-password');
    await member.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(member.getByRole('link', { name: 'Orders' })).toBeVisible();
    await expect(member.getByRole('link', { name: 'Deliveries' })).toHaveCount(0);
    await member.close();

    await row.getByRole('button', { name: 'Actions for Desk Person' }).click();
    await page.getByRole('menuitem', { name: 'Turn off access' }).click();
    await expect(row).toContainText('No access');
  } finally {
    if (userId) await call(page, 'DELETE', `/users/${userId}`);
    if (roleId) await call(page, 'DELETE', `/roles/${roleId}`);
  }
  expect(errors).toEqual([]);
});
