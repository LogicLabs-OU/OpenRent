import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

test('staff write a checklist and a failed check on the scan page takes the unit out of service', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const cat = await call(page, 'POST', '/categories', { name: `Scooters ${stamp}` });
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Scooter ${stamp}`, visibility: 'hidden', tracking: 'serialized', category_ids: [cat.id], price: { kind: 'per_period', period_unit: 'day', amount: 1500 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default).id;
  const unit = await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location, barcode: `SC-${stamp}` });
  let templateId: string | undefined;
  try {
    await page.goto(`${ADMIN}/maintenance`);
    await page.getByRole('link', { name: 'Checklists' }).click();
    await page.getByRole('button', { name: 'New checklist' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Name').fill(`Scooter check ${stamp}`);
    await sheet.getByLabel(`Scooters ${stamp}`).check();
    await sheet.getByRole('button', { name: 'Save' }).click();
    // The first item has no label yet: the error is next to it.
    await expect(sheet.getByTestId('checklist-item').first()).toContainText("Enter the label in the shop's language");
    await sheet.getByLabel('Label (English)').first().fill('Brakes');
    await sheet.getByRole('button', { name: 'Add an item' }).click();
    const second = sheet.getByTestId('checklist-item').nth(1);
    await second.getByLabel('Label (English)').fill('Battery %');
    await second.getByLabel('Answer').selectOption('number');
    await second.getByLabel('At least').fill('80');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('checklist-row').filter({ hasText: `Scooter check ${stamp}` })).toContainText('2');
    templateId = (await call(page, 'GET', '/inspection_templates')).data.find((x: any) => x.name === `Scooter check ${stamp}`).id;

    await page.goto(`${ADMIN}/scan`);
    await page.getByRole('radio', { name: 'Inspect' }).click();
    await page.getByLabel('Type or scan a code').fill(unit.barcode);
    await page.getByLabel('Type or scan a code').press('Enter');
    const runner = page.getByTestId('inspection-runner');
    await expect(runner).toContainText(`Scooter check ${stamp}`);
    await runner.getByRole('radio', { name: 'Pass' }).click();
    await runner.getByLabel('Battery %', { exact: true }).fill('40');
    await shot(page, 'admin-inspection');
    await runner.getByRole('button', { name: 'Save inspection' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'failed its checklist' }).last()).toBeVisible();
    expect((await call(page, 'GET', `/stock_items/${unit.id}`)).status).toBe('soft_down');
    const ins = (await call(page, 'GET', `/stock_items/${unit.id}/inspections`)).data;
    expect(ins.map((i: any) => [i.passed, i.results.map((r: any) => r.passed)])).toEqual([[false, [true, false]]]);
  } finally {
    if (templateId) await call(page, 'DELETE', `/inspection_templates/${templateId}`);
  }
  expect(errors).toEqual([]);
});
