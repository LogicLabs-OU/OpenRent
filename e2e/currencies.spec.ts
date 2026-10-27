import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, ADMIN, STORE, collectErrors, hydrated, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// Prices in other currencies (FR-I18N-7): staff add one with a rate, shoppers switch, the shop's own is charged.
test('staff show prices in another currency and shoppers pay in the shop’s own', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Currency canoe ${stamp}`, tracking: 'bulk', visibility: 'public', price: { kind: 'per_period', period_unit: 'day', amount: 5000 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location.id}`, { quantity: 5 });
  try {
    await page.goto(`${ADMIN}/settings`);
    const card = page.getByTestId('currency-settings');
    await card.getByLabel('USD', { exact: true }).click();
    await card.getByLabel('USD for 1 EUR').fill('0');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByText('Enter a rate above 0, like 1.08')).toBeVisible();
    await card.getByLabel('USD for 1 EUR').fill('1.1');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    await page.mouse.move(0, 0);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="currency-settings"]').analyze()).violations).toEqual([]);

    const shopper = await (await browser.newContext()).newPage();
    await shopper.goto(`${STORE}/p/${product.slug}`);
    await hydrated(shopper);
    await expect(shopper.getByTestId('price-tax-hint')).toHaveText('Prices include VAT');
    const switcher = shopper.getByTestId('currency-switcher');
    await switcher.getByLabel('Prices in').selectOption('USD');
    await expect(switcher).toContainText('approximate, you pay in EUR');
    // €50.00 a day plus 24 % VAT is €62.00, about $68.20.
    await expect(shopper.getByText('≈ $68.20').first()).toBeVisible();
    expect((await new AxeBuilder({ page: shopper }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="currency-switcher"]').analyze()).violations).toEqual([]);

    const start = new Date(`${weekday(randomOffset())}T10:00:00.000Z`);
    await shopper.request.post(`${STORE}/_or/dates`, { data: { from: start.toISOString(), to: new Date(start.getTime() + 86400_000).toISOString() } });
    await shopper.request.post(`${STORE}/_or/cart`, { data: { variant_id: product.variants[0].id, quantity: 1 } });
    await shopper.goto(`${STORE}/checkout`);
    await hydrated(shopper);
    await expect(shopper.getByTestId('checkout-currency-note')).toHaveText('You pay in EUR. Prices in USD were approximate.');
    // What is charged shows in euros.
    await expect(shopper.getByText(/€62\.00/).first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await call(page, 'PATCH', '/tenant/settings', { display_currencies: { currencies: [], rates: {} } });
  }
});
