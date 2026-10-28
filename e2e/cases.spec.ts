import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff pack mics in a flight case, then pick up the order by scanning the case', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const mic = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Case mic ${stamp}`, visibility: 'hidden', tracking: 'serialized', buffer_after_min: 0, price: { kind: 'per_period', period_unit: 'day', amount: 1500 } });
  const box = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Flight case ${stamp}`, visibility: 'hidden', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 500 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default).id;
  for (const n of [1, 2]) await call(page, 'POST', '/stock_items', { variant_id: mic.variants[0].id, location_id: location, barcode: `CM-${stamp}-${n}` });
  const caseUnit = await call(page, 'POST', '/stock_items', { variant_id: box.variants[0].id, location_id: location, barcode: `FC-${stamp}` });

  // The unit page of the case: pack both mics by their barcodes.
  await page.goto(`${ADMIN}/inventory/units/${caseUnit.id}`);
  const card = page.getByTestId('unit-case');
  await expect(card.getByText('Nothing is packed in this unit.')).toBeVisible();
  for (const n of [1, 2]) {
    await card.getByLabel('Barcode to pack').fill(`CM-${stamp}-${n}`);
    await card.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card.getByRole('link', { name: `CM-${stamp}-${n}` })).toBeVisible();
  }
  // A code that is no unit is told at the field.
  await card.getByLabel('Barcode to pack').fill(`NOPE-${stamp}`);
  await card.getByRole('button', { name: 'Pack', exact: true }).click();
  await expect(card.getByText(`No unit with barcode NOPE-${stamp}`)).toBeVisible();
  await card.getByLabel('Barcode to pack').fill('');
  await page.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="unit-case"]').analyze();
  expect(axe.violations).toEqual([]);
  await shot(page, 'admin-case-contents');

  // A mic's own page says which case it is in.
  await card.getByRole('link', { name: `CM-${stamp}-1` }).click();
  await expect(page.getByRole('link', { name: `FC-${stamp}` })).toBeVisible();

  const customer = await call(page, 'POST', '/customers', { name: 'Case Tester', email: `case-${stamp}@example.com` });
  const order = await call(page, 'POST', '/orders', {
    customer_id: customer.id,
    starts_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    ends_at: new Date(Date.now() + 5 * 3600_000).toISOString(),
    lines: [{ variant_id: mic.variants[0].id, quantity: 2 }],
  });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });
  try {
    await page.goto(`${ADMIN}/scan`);
    await page.getByRole('radio', { name: 'Pick up' }).click();
    const input = page.getByLabel('Type or scan a code');
    await input.fill(String(order.number));
    await input.press('Enter');
    await expect(page.getByTestId('scan-order')).toContainText(`Order #${order.number}`);
    await input.fill(`FC-${stamp}`);
    await input.press('Enter');
    await expect(page.locator('[data-tone="ok"]').first()).toContainText(`FC-${stamp} assigned · Case with 2 units`);
    const units = (await call(page, 'GET', `/orders/${order.id}`)).lines[0].units.map((u: any) => u.barcode).sort();
    expect(units).toEqual([`CM-${stamp}-1`, `CM-${stamp}-2`]);

    // Returning: scanning the case brings both mics back.
    await call(page, 'POST', `/orders/${order.id}/actions/check_out`, {});
    await page.getByRole('radio', { name: 'Check in returns' }).click();
    await input.fill(`FC-${stamp}`);
    await input.press('Enter');
    await expect(page.locator('[data-tone="ok"]').first()).toContainText(`E2E Flight case ${stamp} checked in · Case with 2 units`);
    expect((await call(page, 'GET', `/orders/${order.id}`)).status).toBe('returned');
  } finally {
    const o = await call(page, 'GET', `/orders/${order.id}`);
    if (o.status === 'out') await call(page, 'POST', `/orders/${order.id}/actions/check_in`, { all: true });
    if (o.status === 'reserved') await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
  }
  expect(errors).toEqual([]);
});
