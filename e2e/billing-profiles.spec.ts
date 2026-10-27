import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { startViesFake, type ViesFake } from '@openrent/tax-fakes';
import { test, messageHtml, ADMIN, STORE, collectErrors, hydrated, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;
const day = 86400_000;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

async function serious(page: Page, include: string) {
  await page.mouse.move(0, 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(include).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

let vies: ViesFake;
test.beforeAll(async () => {
  vies = await startViesFake();
});
test.afterAll(() => vies?.close());

test('a customer saves company billing details and books with them, without VAT', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await signIn(page);
  const n = String(Date.now()).slice(-9);
  const vat = `DE${n}`;
  vies.numbers[vat] = { name: `Bühne ${n} GmbH`, address: 'Hauptstr. 1, Berlin' };
  const email = `bill-${n}@example.com`;
  const created = await call(page, 'POST', '/customers', { name: 'Bea Billing', email });
  await call(page, 'PATCH', '/plugins/tax-vies', { enabled: true, config: { api_url: vies.url, requester_vat: 'EE100931558' } });
  try {
    // Staff invite the customer to their account; the link signs in.
    await call(page, 'POST', `/customers/${created.id}/actions/send_portal_link`);
    const customer = await (await browser.newContext()).newPage();
    const msg = (await call(page, 'GET', '/notifications?limit=50')).data.find((x: any) => x.template === 'portal_invitation' && x.recipient === email);
    const token = /token(?:=|&#x3D;)([\w-]+)/.exec(await messageHtml(msg.id))![1]!;
    await customer.goto(`${STORE}/account/verify?token=${token}`);
    await hydrated(customer);
    await customer.getByRole('button', { name: 'Sign in' }).click();
    await expect(customer).toHaveURL(/\/account$/);
    await hydrated(customer);

    // Company billing details: the address is needed, and the VAT number is checked.
    const card = customer.getByTestId('account-billing');
    await card.getByRole('button', { name: 'Add billing details' }).click();
    const form = card.getByTestId('billing-form');
    await form.getByLabel('Bill to').selectOption('company');
    await form.getByLabel('Contact person').fill('Bea Billing');
    await form.getByLabel('Company name').fill(`Bühne ${n} GmbH`);
    await form.getByLabel('VAT number').fill(vat);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByText('Street is missing')).toBeVisible();
    await form.getByLabel('Street and number').fill('Hauptstr. 1');
    await form.getByLabel('City').fill('Berlin');
    await form.getByLabel('Country').fill('DE');
    await form.getByRole('button', { name: 'Save' }).click();
    const saved = card.getByTestId('billing-profile').filter({ hasText: `Bühne ${n} GmbH` });
    await expect(saved).toContainText(`VAT ${vat} · checked`);
    await expect(saved).toContainText('Default');
    expect(await serious(customer, '[data-testid="account-billing"]'), 'billing card').toEqual([]);

    // A cart made on the server reaches the browser like the widget's, then checkout picks the saved details.
    const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
    const catalog = await call(page, 'GET', `/storefront/catalog/products?from=${start.toISOString()}&to=${new Date(start.getTime() + day).toISOString()}&limit=100`);
    const variant = catalog.data.flatMap((p: any) => p.variants).find((v: any) => v.price && (v.available ?? 1) > 0 && v.price.amount.amount > 0);
    const cart = await call(page, 'POST', '/storefront/checkout_sessions', { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + day).toISOString(), lines: [{ variant_id: variant.id, quantity: 1 }] });
    await customer.goto(`${STORE}/cart?session=${cart.id}`);
    await customer.goto(`${STORE}/checkout`);
    await hydrated(customer);
    const picker = customer.getByTestId('checkout-billing');
    await expect(picker.getByRole('radio', { name: new RegExp(`Bühne ${n} GmbH`) })).toBeChecked();
    expect(await serious(customer, '[data-testid="checkout-billing"]'), 'billing picker').toEqual([]);
    await customer.getByLabel('Full name').fill('Bea Billing');
    await customer.getByLabel('Email').fill(email);
    await customer.getByLabel('I accept the rental terms').check();
    await customer.getByRole('button', { name: /place booking/i }).click();
    await expect(customer.getByRole('heading', { name: /thank you, your booking #\d+/i })).toBeVisible({ timeout: 15_000 });
    const number = Number(/#(\d+)/.exec((await customer.getByRole('heading', { name: /thank you/i }).textContent()) ?? '')![1]);
    await customer.context().close();

    // Staff see the company on the order, and no VAT.
    const order = (await call(page, 'GET', `/orders/%23${number}`));
    expect(order.billing).toMatchObject({ kind: 'company', company_name: `Bühne ${n} GmbH`, tax_id: vat });
    expect(order.totals.tax.amount).toBe(0);
    await page.goto(`${ADMIN}/orders/${order.id}`);
    await expect(page.getByTestId('order-billing')).toContainText(`Bühne ${n} GmbH`);
  } finally {
    await call(page, 'PATCH', '/plugins/tax-vies', { enabled: false, config: { api_url: null, requester_vat: null } });
  }
  expect(errors).toEqual([]);
});
