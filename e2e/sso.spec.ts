import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, signIn } from './helpers.ts';
import { startOidcMock } from '../apps/api/test/oidc-mock.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('staff of an allowed domain sign in with the company identity provider', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const domain = `sso${stamp}.example`;
  const idp = await startOidcMock({ clientId: 'openrent-e2e', clientSecret: 'e2e-secret' });
  idp.state.user = { sub: `s${stamp}`, email: `grace@${domain}`, email_verified: true, name: 'Grace Hopper' };
  const provider = await call(page, 'POST', '/sso_providers', { name: `Acme ${stamp}`, issuer: idp.issuer, client_id: 'openrent-e2e', client_secret: 'e2e-secret', allowed_domains: [domain], default_role: 'staff' });
  try {
    const staff = await (await browser.newContext()).newPage();
    await staff.goto(`${ADMIN}/login?next=${encodeURIComponent('/admin/orders')}`);
    await staff.getByLabel('Email').fill(`grace@${domain}`);
    await staff.getByTestId('sso-button').filter({ hasText: `Sign in with Acme ${stamp}` }).click();
    await expect(staff).toHaveURL(/\/admin\/orders$/);
    await expect(staff.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
    const me = await (await staff.request.get(`${API}/auth/me`)).json();
    expect([me.user.email, me.role]).toEqual([`grace@${domain}`, 'staff']);
    await staff.close();
  } finally {
    await call(page, 'DELETE', `/sso_providers/${provider.id}`);
    const member = (await call(page, 'GET', '/users')).data.find((u: any) => u.email === `grace@${domain}`);
    if (member) await call(page, 'DELETE', `/users/${member.id}`);
    await idp.close();
  }
  expect(errors).toEqual([]);
});
