import { expect, type Page } from '@playwright/test';
import { startNominatimFake, type NominatimFake } from '@openrent/geo-fakes';
import { test, ADMIN, STORE, collectErrors, hydrated, pickDay, randomOffset, shot, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// The map here is a local stand-in for Nominatim (packages/geo-fakes): the shop on Viru street, a
// customer about 5.5 km away in Pirita, and Tartu, 160 km away.
let nominatim: NominatimFake;
test.beforeAll(async () => {
  nominatim = await startNominatimFake({
    minIntervalMs: 0,
    places: [
      { match: 'viru tallinn', lat: 59.4366, lon: 24.749, country: 'ee' },
      { match: 'pirita tallinn', lat: 59.4689, lon: 24.828, country: 'ee' },
      { match: 'tartu', lat: 58.378, lon: 26.729, country: 'ee' },
    ],
  });
});
test.afterAll(async () => {
  await nominatim?.close();
});

test('staff price delivery by distance and a customer sees it change with the address', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await call(page, 'PATCH', '/plugins/geocode-osm', { enabled: true, config: { nominatim_url: nominatim.url, requests_per_second: 50 } });
  const name = `Distance tent ${Date.now()}`;
  const product = await call(page, 'POST', '/products', { type: 'rental', name, visibility: 'public', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
  const feeName = `Van delivery ${product.id.slice(-5)}`;

  try {
    await page.goto(`${ADMIN}/pricing?tab=fees`);
    await page.getByRole('button', { name: 'New fee' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(feeName);
    await dialog.getByLabel('Type').selectOption('delivery');
    await dialog.getByLabel('Added').selectOption('optional');
    await dialog.getByLabel('Calculated as').selectOption('per_km');
    await dialog.getByLabel('Band 1: up to km').fill('0');
    await dialog.getByLabel(/^Amount/).first().fill('15');
    await dialog.getByRole('button', { name: 'Add a band' }).click();
    await dialog.getByLabel('Band 2: up to km').fill('40');
    await dialog.getByLabel(/^Amount/).nth(1).fill('30');
    await dialog.getByLabel('Add a product').fill(name);
    await dialog.getByRole('button', { name }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    // 0 km is no distance: the error shows at that band.
    await expect(dialog.getByText('Enter kilometres above 0, or leave it empty for any distance')).toBeVisible();
    await dialog.getByLabel('Band 1: up to km').fill('10');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('fee-rule-row').filter({ hasText: feeName })).toContainText('2 distance bands');
    await shot(page, 'admin-fee-distance');

    const shopper = await (await browser.newContext()).newPage();
    const shopperErrors = collectErrors(shopper);
    await shopper.goto(STORE);
    await hydrated(shopper);
    const start = randomOffset();
    const bar = shopper.getByTestId('date-bar');
    await bar.locator('#or-dates').click();
    const calendar = shopper.locator('[data-slot="popover-content"]');
    await pickDay(calendar, weekday(start));
    await pickDay(calendar, weekday(start + 1));
    await bar.getByRole('button', { name: /show what/i }).click();
    await expect(shopper.locator('[data-availability]').first()).toBeVisible();
    await shopper.goto(`${STORE}/p/${product.slug}`);
    await hydrated(shopper);
    await expect(shopper.getByTestId('price-total')).toBeVisible();
    await shopper.getByRole('button', { name: 'Add to cart' }).click();
    await expect(shopper.locator('p[role="status"]', { hasText: 'Added to your cart' })).toBeVisible();
    await shopper.goto(`${STORE}/checkout`);
    await hydrated(shopper);

    const extras = shopper.getByTestId('optional-fees');
    const fee = extras.getByRole('checkbox', { name: new RegExp(feeName) });
    await expect(extras.getByText(feeName).locator('..')).toContainText('Price by distance');
    await fee.click();
    await expect(fee).toBeChecked();
    await expect(extras.getByText('Enter the delivery address')).toBeVisible();
    const address = extras.getByLabel('Delivery address (street, number, city)');
    // Fresh street numbers each run: answers are kept, and this run should look them up.
    const n = Date.now() % 100_000;
    await address.fill(`Riia ${n}, Tartu`);
    await address.press('Enter');
    await expect(extras.getByText('This address is too far away for delivery')).toBeVisible();
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await address.fill(`Pirita tee ${n}, Tallinn`);
    await address.press('Enter');
    const summary = shopper.getByTestId('price-summary');
    await expect(summary).toContainText(feeName);
    await expect(summary.getByText(feeName).locator('..')).toContainText('15.00');
    await expect(address).toHaveAttribute('aria-invalid', 'false');
    await shot(shopper, 'sf-checkout-distance');
    expect(nominatim.searches.filter((s) => s.q.includes(String(n))).every((s) => /^OpenRent\//.test(s.userAgent))).toBe(true);
    expect(nominatim.searches.some((s) => s.q.includes(String(n)))).toBe(true);
    expect(shopperErrors).toEqual([]);
  } finally {
    await call(page, 'PATCH', '/plugins/geocode-osm', { enabled: false });
    const fee = (await call(page, 'GET', '/fee_rules?limit=200')).data.find((f: any) => f.name === feeName);
    if (fee) await call(page, 'DELETE', `/fee_rules/${fee.id}`);
    await call(page, 'POST', `/products/${product.id}/actions/archive`, {});
  }
  expect(errors).toEqual([]);
});
