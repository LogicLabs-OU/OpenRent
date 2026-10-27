import { expect, type Page } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, hydrated, shot, signIn, weekday, randomOffset } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    data,
    headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('staff work in German, and customers shop in their own language', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  // The admin language belongs to each staff member, so this part uses its own member: other specs
  // share the owner's session and must stay in English.
  const email = `lang-${Date.now()}@example.com`;
  const member = await call(page, 'POST', '/users', {
    email,
    name: 'Lang Tester',
    role: 'staff',
    password: 'openrent-lang',
  });
  try {
    const staff = await (await browser.newContext()).newPage();
    const login = await staff.request.post(`${API}/auth/login`, {
      data: { email, password: 'openrent-lang' },
    });
    expect(login.ok(), await login.text()).toBe(true);
    await staff.goto(ADMIN);
    await expect(staff.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const sidebar = staff.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByRole('link', { name: 'Orders' })).toBeVisible();
    await staff.getByRole('button', { name: /Lang Tester/ }).click();
    await staff.getByTestId('admin-language').click();
    await staff.getByRole('menuitemradio', { name: 'Deutsch' }).click();
    await expect(staff.locator('html')).toHaveAttribute('lang', 'de');
    await expect(sidebar.getByRole('link', { name: 'Aufträge' })).toBeVisible();
    // Choosing a language leaves the menu open, like the colour theme choice.
    await staff.keyboard.press('Escape');
    await staff.keyboard.press('Escape');
    await expect(staff.getByRole('menu')).toHaveCount(0);
    await shot(staff, 'admin-german');
    // The choice is saved: a reload stays in German.
    await staff.reload();
    await expect(staff.getByRole('heading', { name: 'Heute', exact: true })).toBeVisible();
    // Dutch too (a PRD launch language).
    await staff.getByRole('button', { name: /Lang Tester/ }).click();
    await staff.getByTestId('admin-language').click();
    await staff.getByRole('menuitemradio', { name: 'Nederlands' }).click();
    await expect(staff.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(sidebar.getByRole('link', { name: 'Boekingen' })).toBeVisible();
    await staff.keyboard.press('Escape');
    await staff.keyboard.press('Escape');
    await expect(staff.getByRole('heading', { name: 'Vandaag', exact: true })).toBeVisible();

    // The shop turns on German, Estonian and Japanese.
    await page.goto(`${ADMIN}/settings`);
    const langs = page.getByTestId('language-settings');
    for (const name of ['Deutsch', 'Eesti', '日本語', 'Nederlands']) await langs.getByLabel(name).check();
    await langs.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();

    // A category and a product get German names.
    await page.goto(`${ADMIN}/categories`);
    await page
      .getByTestId('category-row')
      .filter({ hasText: 'Bikes' })
      .getByRole('button', { name: 'Edit Bikes' })
      .click();
    await page.getByRole('dialog').getByLabel('Name (Deutsch)').fill('Fahrräder');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const kayak = (await call(page, 'GET', '/products?q=Sea%20kayak')).data.find(
      (p: { name: string }) => p.name === 'Sea kayak',
    );
    await page.goto(`${ADMIN}/products/${kayak.id}`);
    const translations = page.getByTestId('product-translations');
    await translations.getByRole('tab', { name: 'Deutsch' }).click();
    await translations.getByRole('tabpanel').getByLabel('Name', { exact: true }).fill('Seekajak');
    await translations.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'Translations saved' }).last(),
    ).toBeVisible();
    await shot(page, 'admin-product-translations');

    // German storefront: own URL prefix, page language, translated names and texts.
    const shopper = await (await browser.newContext({ locale: 'en-US' })).newPage();
    await shopper.goto(`${STORE}/de/`);
    await hydrated(shopper);
    await expect(shopper.locator('html')).toHaveAttribute('lang', 'de');
    await expect(shopper.getByRole('link', { name: 'Fahrräder' }).first()).toBeVisible();
    await expect(shopper.getByTestId('language-menu')).toHaveText(/DE/);
    await shopper.goto(`${STORE}/de/p/sea-kayak`);
    await expect(shopper.getByRole('heading', { name: 'Seekajak' })).toBeVisible();
    await expect(shopper.getByRole('link', { name: 'Warenkorb' })).toBeVisible();
    await shot(shopper, 'sf-german-product');
    // English stays at the plain address.
    await shopper.goto(`${STORE}/p/sea-kayak`);
    await expect(shopper.getByRole('heading', { name: 'Sea kayak' })).toBeVisible();

    // A Dutch browser goes to /nl, in Dutch.
    const dutch = await (await browser.newContext({ locale: 'nl-NL' })).newPage();
    await dutch.goto(STORE);
    await expect(dutch).toHaveURL(/\/nl\/?$/);
    await expect(dutch.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(dutch.getByRole('link', { name: 'Winkelwagen' })).toBeVisible();
    await shot(dutch, 'sf-dutch-home');

    // First visit with an Estonian browser goes to /et; choosing English sticks after a reload.
    const visitor = await (await browser.newContext({ locale: 'et-EE' })).newPage();
    await visitor.goto(STORE);
    await expect(visitor).toHaveURL(/\/et\/?$/);
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'et');
    await expect(visitor.getByRole('link', { name: 'Ostukorv' })).toBeVisible();
    await hydrated(visitor);
    await shot(visitor, 'sf-estonian-home');
    await visitor.getByTestId('language-menu').click();
    await visitor.getByRole('menuitem', { name: 'English' }).click();
    await expect(visitor).toHaveURL(new RegExp(`^${STORE}/?$`));
    await visitor.reload();
    await expect(visitor).toHaveURL(new RegExp(`^${STORE}/?$`));
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'en');

    // A booking from the Japanese storefront: the confirmation email is in Japanese.
    const ja = await (await browser.newContext({ locale: 'ja-JP' })).newPage();
    await ja.goto(`${STORE}/ja/p/sea-kayak`);
    await hydrated(ja);
    await shot(ja, 'sf-japanese-product');
    const day = weekday(randomOffset());
    const headers = { 'x-or-locale': 'ja', 'content-type': 'application/json' };
    await ja.request.post(`${STORE}/_or/dates`, {
      headers,
      data: { from: `${day}T08:00:00.000Z`, to: `${day}T15:00:00.000Z` },
    });
    const product = await (await ja.request.get(`${API}/storefront/catalog/products/sea-kayak`)).json();
    await ja.request.post(`${STORE}/_or/cart`, {
      headers,
      data: { variant_id: product.variants[0].id, quantity: 1, mode: 'add' },
    });
    const placed = await (
      await ja.request.post(`${STORE}/_or/checkout`, {
        headers,
        data: {
          customer: { name: '山田 花子', email: `ja-${Date.now()}@example.com` },
          terms_accepted: true,
        },
      })
    ).json();
    expect(placed.order?.number, JSON.stringify(placed)).toBeTruthy();
    const log = await call(page, 'GET', `/notifications?order_id=${placed.order.id}`);
    const confirmation = log.data.find((n: { template: string }) => n.template === 'order_confirmed');
    expect(confirmation.subject).toContain(String(placed.order.number));
    expect(confirmation.subject).not.toMatch(/Your booking/);
  } finally {
    await call(page, 'PATCH', '/tenant/settings', { storefront: { locales: ['en'], default_locale: 'en' } });
    await call(page, 'DELETE', `/users/${member.id}`);
  }
  expect(errors).toEqual([]);
});
