import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'DELETE' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('staff define a product field, write a rich description and shoppers see both', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const n = Date.now() % 100000;
  const key = `max_load_${n}`;
  const name = `Max load ${n}`;
  await page.goto(`${ADMIN}/settings?tab=custom_fields`);
  await page.getByRole('button', { name: 'New field' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Label').first().fill(name);
  await sheet.getByLabel('Key').fill(key);
  await sheet.getByLabel('Type').selectOption('number');
  await sheet.getByLabel('Who sees it').selectOption('storefront');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('custom-field-row').filter({ hasText: key })).toBeVisible();
  const def = (await call(page, 'GET', '/custom_field_definitions?filter[entity]=product')).data.find((d: { key: string }) => d.key === key);

  try {
    const kayak = (await call(page, 'GET', '/products?q=Sea%20kayak')).data.find((p: { name: string }) => p.name === 'Sea kayak');
    const before = kayak.description;
    await page.goto(`${ADMIN}/products/${kayak.id}`);
    await page.getByLabel(name).fill('120');
    const editor = page.getByRole('textbox', { name: 'Description', exact: true });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Stable touring kayak. ');
    // Other languages may add more editors (the languages test turns some on in parallel).
    await page.getByTestId('rich-text-editor').filter({ has: editor }).getByRole('button', { name: 'Bold' }).click();
    await page.keyboard.type('Spray deck included');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();
    await shot(page, 'admin-product-rich-text');

    try {
      await page.goto(`${STORE}/p/sea-kayak`);
      await hydrated(page);
      await expect(page.locator('.rich-text strong')).toHaveText('Spray deck included');
      await expect(page.getByTestId('product-fields')).toContainText(name);
      await expect(page.getByTestId('product-fields')).toContainText('120');
      await shot(page, 'sf-product-fields');
    } finally {
      await call(page, 'PATCH', `/products/${kayak.id}`, { description: before, custom_fields: {} });
    }
  } finally {
    await call(page, 'DELETE', `/custom_field_definitions/${def.id}`);
  }
  expect(errors).toEqual([]);
});
