import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, settled, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

async function serious(page: Page, include: string) {
  await page.mouse.move(0, 0);
  await settled(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(include).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);
}

test('staff record a PAT test on a unit, and an untested one cannot go out', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Heater ${stamp}`, tracking: 'serialized', visibility: 'hidden', price: { kind: 'per_period', period_unit: 'day', amount: 1500 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  const tested = await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location.id, barcode: `HT-${stamp}-1` });
  await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location.id, barcode: `HT-${stamp}-2` });
  const interval = await call(page, 'POST', '/service_intervals', { name: `E2E PAT ${stamp}`, kind: 'electrical_test', product_id: product.id, every_days: 365 });

  try {
    await page.goto(`${ADMIN}/inventory/units/${tested.id}`);
    const card = page.getByTestId('electrical-tests');
    await expect(card.getByTestId('pat-status')).toContainText('May not go out');
    await card.getByRole('button', { name: 'Record test' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tested by').fill('');
    await dialog.getByRole('button', { name: 'Save' }).click();
    // Class I passes need the earth reading; both problems show next to their fields.
    await expect(dialog.getByText('Enter who tested')).toBeVisible();
    await expect(dialog.getByText('A class I appliance that passes needs its earth continuity reading')).toBeVisible();
    await dialog.getByLabel('Tested by').fill('Mari Maasikas');
    await dialog.getByLabel('Earth continuity (Ω)').fill('0,09');
    await dialog.getByLabel('Insulation resistance (MΩ)').fill('150');
    await dialog.getByLabel('Instrument').fill('Fluke 6500-2');
    expect(await serious(page, '[role="dialog"]'), 'test dialog').toEqual([]);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Test recorded' }).last()).toBeVisible();
    await expect(card.getByTestId('pat-status')).toContainText('Tested and safe to go out until');
    await expect(card.getByTestId('pat-test')).toHaveCount(1);
    await expect(card.getByRole('button', { name: /^Certificate of the test on/ })).toBeVisible();
    expect(await serious(page, '[data-testid="electrical-tests"]'), 'tests card').toEqual([]);
    await shot(page, 'admin-electrical-tests');

    // The untested heater is refused when scanned onto a booking.
    const customer = await call(page, 'POST', '/customers', { name: 'Cold Office', email: `heat-${stamp}@example.com` });
    const order = await call(page, 'POST', '/orders', { customer_id: customer.id, location_id: location.id, starts_at: new Date(Date.now() + 5 * 60_000).toISOString(), ends_at: new Date(Date.now() + 5 * 3600_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }], deposit: { mode: 'none' } });
    await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });
    await page.goto(`${ADMIN}/scan`);
    await page.getByRole('radio', { name: 'Pick up' }).click();
    const input = page.getByLabel('Type or scan a code');
    await input.fill(String(order.number));
    await input.press('Enter');
    await expect(page.getByTestId('scan-order')).toContainText(`Order #${order.number}`);
    await input.fill(`HT-${stamp}-2`);
    await input.press('Enter');
    await expect(page.locator('[data-tone="error"]').first()).toContainText(`No valid electrical safety test: HT-${stamp}-2`);
    await input.fill(`HT-${stamp}-1`);
    await input.press('Enter');
    await expect(page.locator('[data-tone="ok"]').first()).toContainText(`HT-${stamp}-1`);
    await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
  } finally {
    await call(page, 'DELETE', `/service_intervals/${interval.id}`);
  }
  expect(errors).toEqual([]);
});
