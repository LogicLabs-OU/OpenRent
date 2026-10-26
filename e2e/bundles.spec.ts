import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, STORE, collectErrors, hydrated, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// Choice bundles (FR-CAT-6): staff give components a choice group; the customer picks one online.
test('a choice bundle: slots in the admin, the customer picks a lens, the order books it', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  const make = async (name: string, amount: number, qty: number) => {
    const p = await call(page, 'POST', '/products', { type: 'rental', name: `${name} ${stamp}`, tracking: 'bulk', visibility: 'hidden', price: { kind: 'per_period', period_unit: 'day', amount } });
    await call(page, 'PUT', `/stock_levels/${p.variants[0].id}/${location.id}`, { quantity: qty });
    return p.variants[0].id as string;
  };
  const body = await make('E2E Body', 5000, 2);
  const wide = await make('E2E Wide lens', 2000, 2);
  const tele = await make('E2E Tele lens', 3000, 2);
  const kit = await call(page, 'POST', '/bundles', {
    name: `E2E Camera kit ${stamp}`, visibility: 'public',
    bundle: { components: [{ variant_id: body, quantity: 1 }, { variant_id: wide, quantity: 1, slot_name: 'Lens' }, { variant_id: tele, quantity: 1, slot_name: 'Lens' }] },
  });

  await page.goto(`${ADMIN}/products/${kit.id}`);
  const editor = page.getByTestId('bundle-components');
  await expect(editor.getByLabel(`Choice group of E2E Tele lens ${stamp}`)).toHaveValue('Lens');
  await expect(editor.getByLabel(`Choice group of E2E Body ${stamp}`)).toHaveValue('');

  // The customer picks the tele lens on the product page.
  const shopper = await (await browser.newContext()).newPage();
  const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
  await shopper.request.post(`${STORE}/_or/dates`, { data: { from: start.toISOString(), to: new Date(start.getTime() + 86400_000).toISOString() } });
  await shopper.goto(`${STORE}/p/${kit.slug}`);
  await hydrated(shopper);
  const picker = shopper.getByTestId('bundle-picker');
  await expect(picker.getByRole('radio', { name: `E2E Wide lens ${stamp}` })).toBeChecked();
  await picker.getByRole('radio', { name: `E2E Tele lens ${stamp}` }).check();
  await shopper.mouse.move(0, 0);
  const axe = await new AxeBuilder({ page: shopper }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="bundle-picker"]').analyze();
  expect(axe.violations).toEqual([]);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await expect(shopper.locator('p[role="status"]', { hasText: 'Added to your cart' })).toBeVisible();
  await shopper.goto(`${STORE}/checkout`);
  await hydrated(shopper);
  await shopper.getByLabel('Full name').fill('Kit Picker');
  await shopper.getByLabel('Email').fill(`kit-${stamp}@example.com`);
  await shopper.getByLabel('I accept the rental terms').check();
  await shopper.getByRole('button', { name: /place booking/i }).click();
  await expect(shopper.getByRole('heading', { name: /thank you, your booking #\d+/i })).toBeVisible({ timeout: 15_000 });
  await shopper.context().close();

  // The booking has the tele lens, and staff can switch it while it is a draft.
  const orders = (await call(page, 'GET', `/orders?q=${encodeURIComponent(`kit-${stamp}@example.com`)}`)).data;
  const order = await call(page, 'GET', `/orders/${orders[0].id}`);
  expect(order.lines[0].components.map((c: any) => c.variant_id).sort()).toEqual([body, tele].sort());
  await page.goto(`${ADMIN}/orders/${order.id}`);
  await expect(page.getByTestId('bundle-picks').getByLabel('Lens')).toHaveValue(tele);
  await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
  expect(errors).toEqual([]);
});
