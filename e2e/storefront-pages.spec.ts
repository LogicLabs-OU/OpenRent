import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, hydrated, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

async function serious(page: Page, include?: string) {
  // Off any hovered button, as a visitor reading the page would be.
  await page.mouse.move(0, 0);
  // Toasts fade in and out; their colours are checked in the component stories.
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('[data-sonner-toaster]');
  if (include) b = b.include(include);
  return (await b.analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('staff write a page with sections, put it in the menu, and shoppers open it in two themes', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await signIn(page);
  const n = Date.now() % 100000;
  const title = `Opening times ${n}`;
  const before = await call(page, 'GET', '/storefront_navigation');
  let pageId = '';
  try {
    await page.goto(`${ADMIN}/pages`);
    await page.getByRole('button', { name: 'New page' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('button', { name: 'Create page' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    pageId = page.url().split('/').pop()!;

    // The text, published.
    const editor = page.getByRole('textbox', { name: /^Text \(/ }).first();
    await editor.click();
    await page.keyboard.type('We open at nine on weekdays.');
    await page.getByLabel('Published').click();
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Saved').first()).toBeVisible();

    // A questions section for the live theme.
    await page.getByRole('button', { name: 'Add section' }).click();
    await page.getByRole('menuitem', { name: 'Questions and answers' }).click();
    const sections = page.getByTestId('section-list').locator('xpath=ancestor::*[@data-slot="card"][1]');
    await sections.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Sections saved').first()).toBeVisible();
    expect(await serious(page), 'page editor').toEqual([]);

    // The header menu gets the page.
    await page.goto(`${ADMIN}/pages`);
    const menus = page.getByTestId('storefront-navigation');
    await menus.getByRole('button', { name: 'Add link' }).click();
    const item = menus.getByTestId('menu-item').last();
    await item.getByLabel('Opens').selectOption('page');
    await item.getByLabel('Page', { exact: true }).selectOption({ label: title });
    await menus.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    expect(await serious(page), 'pages list').toEqual([]);

    const shopper = await (await browser.newContext()).newPage();
    try {
      await shopper.goto(`${STORE}/`);
      await hydrated(shopper);
      await shopper.getByRole('link', { name: title }).first().click();
      await expect(shopper).toHaveURL(new RegExp('/pages/opening-times-'));
      await expect(shopper.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(shopper.getByText('We open at nine on weekdays.')).toBeVisible();
      await expect(shopper.getByText('Questions').first()).toBeVisible();
      await expect(shopper).toHaveTitle(new RegExp(`^${title} · `));
      expect(await serious(shopper), 'storefront page').toEqual([]);
      const sitemap = await (await shopper.request.get(`${STORE}/sitemap.xml`)).text();
      expect(sitemap).toContain(`/pages/opening-times-${n}</loc>`);

      // The same page in another theme, through a preview: its text, without the other theme's sections.
      const preview = new URL((await call(page, 'POST', '/themes/retro/actions/preview')).url);
      preview.pathname = `/pages/opening-times-${n}`;
      const other = await (await browser.newContext()).newPage();
      try {
        await other.goto(preview.href);
        await expect(other.getByRole('heading', { level: 1, name: title })).toBeVisible();
        await expect(other.getByText('We open at nine on weekdays.')).toBeVisible();
      } finally {
        await other.context().close();
      }
    } finally {
      await shopper.context().close();
    }
  } finally {
    await call(page, 'PUT', '/storefront_navigation', { header: before.header, footer: before.footer });
    if (pageId) await call(page, 'DELETE', `/storefront_pages/${pageId}`);
  }
  expect(errors).toEqual([]);
});
