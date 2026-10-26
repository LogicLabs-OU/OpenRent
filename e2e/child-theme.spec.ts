import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

/** A child theme of the default theme: a darker text colour and a renamed "All products" link. */
function childTheme(id: string) {
  return Buffer.from(
    zipSync({
      'theme.json': strToU8(JSON.stringify({ id, name: 'E2E Harbour', version: '1.0.0', author: 'E2E', license: 'MIT', compat: '^1.4.0', extends: 'default', locales: ['en'] })),
      'config/settings_data.json': strToU8(JSON.stringify({ accent: '#be123c' })),
      'locales/en.json': strToU8(JSON.stringify({ 'nav.all': 'Everything to rent' })),
      'theme.css': strToU8('main { outline: 3px solid rgb(190, 18, 60); }'),
    }),
  );
}

test('an owner uploads a child theme, previews it and the storefront uses it', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const id = `e2e-harbour-${Date.now().toString(36)}`;
  await page.goto(`${ADMIN}/themes`);
  await page.getByTestId('theme-install').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Theme package (.zip)').setInputFiles({ name: `${id}.zip`, mimeType: 'application/zip', buffer: childTheme(id) });
  await dialog.getByRole('button', { name: 'Check package' }).click();
  const review = dialog.getByTestId('theme-install-review');
  await expect(review).toContainText('Version 1.0.0, based on default.');
  await expect(review).toContainText('theme.css');
  await shot(page, 'admin-theme-install');
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  const card = page.getByTestId('theme-card').filter({ hasText: 'E2E Harbour' }).first();
  await expect(card.getByText('Based on default')).toBeVisible();

  // The signed preview shows the child theme to this browser only.
  const popup = page.waitForEvent('popup');
  await card.getByRole('button', { name: 'Preview' }).click();
  const tab = await popup;
  await tab.waitForURL(new RegExp(`^${STORE}`));
  await hydrated(tab);
  await expect(tab.getByRole('link', { name: 'Everything to rent' }).first()).toBeVisible();
  await expect(tab.locator('main')).toHaveCSS('outline-color', 'rgb(190, 18, 60)');

  // Visitors still see the live theme.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(STORE);
  await hydrated(visitor);
  await expect(visitor.getByRole('link', { name: 'Everything to rent' })).toHaveCount(0);

  await page.getByTestId('theme-card').filter({ hasText: 'E2E Harbour' }).first().getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('theme-card').filter({ hasText: id })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('theme assets have content-hashed URLs that are cached for good', async ({ request }) => {
  const hash = createHash('sha256').update(readFileSync('packages/themes/default/assets/mark.svg')).digest('hex').slice(0, 10);
  const res = await request.get(`${STORE}/themes/default/assets/mark.${hash}.svg`);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await request.get(`${STORE}/themes/default/assets/mark.svg`)).status()).toBe(404);
});
