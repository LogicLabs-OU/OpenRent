import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test, ADMIN, collectErrors, settled, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;
const DAY = 86_400_000;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

async function serious(page: Page, include: string) {
  await page.mouse.move(0, 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(include).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);
}

test('staff see a busy week suggested and turn it into a price rule', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const n = Date.now() % 100000;
  const name = `E2E Kayak ${n}`;
  const product = await call(page, 'POST', '/products', { type: 'rental', name, tracking: 'bulk', visibility: 'hidden', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location.id}`, { quantity: 1 });
  // The one kayak is out from a Sunday evening to the Monday after next week's: its whole week is booked.
  const start = new Date(Date.now() + (14 + (n % 8) * 7) * DAY);
  while (start.getUTCDay() !== 0) start.setTime(start.getTime() + DAY);
  start.setUTCHours(18, 0, 0, 0);
  const customer = await call(page, 'POST', '/customers', { name: 'Kayak Fan', email: `kayak-${n}@example.com` });
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, location_id: location.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 8 * DAY).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }], deposit: { mode: 'none' } });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });

  await page.goto(`${ADMIN}/pricing?tab=suggestions`);
  const card = page.getByTestId('price-suggestions');
  await card.getByRole('button', { name: 'Check now' }).click();
  const row = card.getByTestId('price-suggestion').filter({ hasText: name });
  await expect(row).toContainText('+10%');
  expect(await serious(page, '[data-testid="price-suggestions"]'), 'suggestions tab').toEqual([]);
  await shot(page, 'admin-price-suggestions');

  // The settings say what counts as busy; an impossible pair is refused next to the field.
  await card.getByLabel('Busy from (%)').fill('20');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('A whole number from 50 to 100, above the quiet share')).toBeVisible();
  await card.getByLabel('Busy from (%)').fill('85');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();

  await row.getByRole('button', { name: 'Accept' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Raise the price of ${name}?` })).toBeVisible();
  await dialog.getByLabel('Raise by (%)').fill('12');
  // Colours are checked once the dialog has faded in.
  await settled(page);
  expect(await serious(page, '[role="dialog"]'), 'accept dialog').toEqual([]);
  await dialog.getByRole('button', { name: 'Make price rule' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Price rule made' }).last()).toBeVisible();
  await expect(row).toBeHidden();

  const rule = (await call(page, 'GET', '/price_rules?limit=200')).data.find((r: any) => r.product_ids.includes(product.id));
  expect(rule).toMatchObject({ kind: 'season', adjustment_bp: 1200 });
  await page.getByRole('tab', { name: 'Price rules' }).click();
  await expect(page.getByTestId('price-rule-row').filter({ hasText: name })).toContainText('+12%');

  await call(page, 'DELETE', `/price_rules/${rule.id}`);
  await call(page, 'POST', `/orders/${order.id}/actions/cancel`, {});
  expect(errors).toEqual([]);
});
