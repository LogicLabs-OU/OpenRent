import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, randomOffset, shot, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;
const day = 86400_000;

async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

// The fixture plugin e2e/fixtures/plugins/e2e-extras adds a dashboard card, a checkout field and a badge.
test('a plugin’s admin extension and storefront fields appear where they belong', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await expect(page.getByTestId('plugin-slot').filter({ hasText: 'Hello from the e2e plugin' })).toBeVisible();

  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Badge kayak ${Date.now()}`, tracking: 'bulk', tags: ['e2e-badge'], visibility: 'public', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
  const location = (await call(page, 'GET', '/locations')).data[0].id;
  await page.request.fetch(`${API}/stock_levels/${product.variants[0].id}/${location}`, { method: 'PUT', data: { quantity: 3 }, headers: { 'x-csrf-token': (await page.context().cookies()).find((c) => c.name === 'or_csrf')!.value, 'content-type': 'application/json' } });

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(`${STORE}/p/${product.slug}`);
  await hydrated(shopper);
  await expect(shopper.getByText('Staff pick')).toBeVisible();

  // Book through the API cart, then fill the plugin field on the checkout page.
  const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
  await shopper.request.post(`${STORE}/_or/dates`, { data: { from: start.toISOString(), to: new Date(start.getTime() + day).toISOString() } });
  await shopper.request.post(`${STORE}/_or/cart`, { data: { variant_id: product.variants[0].id, quantity: 1, mode: 'add' } });
  await shopper.goto(`${STORE}/checkout`);
  await hydrated(shopper);
  await shopper.getByLabel('Full name').fill('Plugin Shopper');
  await shopper.getByLabel('Email').fill(`plugin-${Date.now()}@example.com`);
  await shopper.getByLabel('Arrival note').fill('Back gate, after 6');
  await shopper.getByLabel('I accept the rental terms').check();
  await shot(shopper, 'sf-checkout-plugin-field');
  await shopper.getByRole('button', { name: /place booking/i }).click();
  const heading = shopper.getByRole('heading', { name: /thank you, your booking #\d+/i });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())!.match(/#(\d+)/)![1];
  const order = await call(page, 'GET', `/orders/%23${number}`);
  expect(order.custom_fields.plg_e2e_extras_arrival_note).toBe('Back gate, after 6');
  expect(errors).toEqual([]);
});

test('the owner reviews a plugin package before installing it', async ({ page }) => {
  await signIn(page);
  await page.goto(`${ADMIN}/plugins`);
  await page.getByTestId('plugin-install').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Or package address').fill('http://not-https.example/plugin.zip');
  await dialog.getByRole('button', { name: 'Check package' }).click();
  await expect(dialog.getByText('Enter an https address of a .zip file')).toBeVisible();
  await shot(page, 'admin-plugin-install');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});
