import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, hydrated, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('a shopper finds the opening hours and writes to the shop, and staff get the message', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const n = Date.now() % 100000;
  const p = await call(page, 'POST', '/storefront_pages', { title: `Visit ${n}`, status: 'published' });
  try {
    await call(page, 'PUT', `/storefront_pages/${p.id}/sections/default`, {
      sections: [
        { id: 'where', type: 'plugin:openrent:locations', settings: { heading: 'Where we are' } },
        { id: 'write', type: 'plugin:openrent:contact', settings: { heading: 'Ask us', consent: 'You may answer me by email' } },
      ],
    });
    const shopper = await (await browser.newContext()).newPage();
    try {
      await shopper.goto(`${STORE}/pages/${p.slug}`);
      await hydrated(shopper);
      const where = shopper.getByTestId('locations-section');
      await expect(where.getByRole('heading', { name: 'Where we are' })).toBeVisible();
      await expect(where.getByRole('table').first()).toContainText('Monday');
      await expect(where.getByRole('link', { name: 'Show on map' }).first()).toBeVisible();

      const form = shopper.getByTestId('contact-section');
      await form.getByRole('button', { name: 'Send message' }).click();
      await expect(form.getByText('Enter your name')).toBeVisible();
      await expect(form.getByText('Tick the box to send the message')).toBeVisible();
      await form.getByLabel('Name', { exact: true }).fill(`Mari ${n}`);
      await form.getByLabel('Email', { exact: true }).fill(`mari-${n}@example.com`);
      await form.getByLabel('Message', { exact: true }).fill('Can I pick up a kayak before nine?');
      await form.getByLabel('You may answer me by email').click();
      await form.getByRole('button', { name: 'Send message' }).click();
      await expect(form.getByTestId('contact-sent')).toBeVisible();
      const axe = await new AxeBuilder({ page: shopper }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    } finally {
      await shopper.context().close();
    }

    await page.goto(`${ADMIN}/`);
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-item').filter({ hasText: `Mari ${n} wrote: Can I pick up a kayak before nine?` })).toBeVisible();
  } finally {
    await call(page, 'DELETE', `/storefront_pages/${p.id}`);
  }
  expect(errors).toEqual([]);
});
