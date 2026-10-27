import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, hydrated, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
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

test('a shopper switches to the location that has the item, chooses delivery times and adds the booking to their calendar', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await signIn(page);
  const n = Date.now() % 100000;
  const windows = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '12:00'], ['14:00', '17:00']]]));
  const harbour = await call(page, 'POST', '/locations', { name: `Harbour ${n}`, timezone: 'Europe/Tallinn', address: { line1: 'Sadama 25', city: 'Tallinn' }, delivery_windows: windows });
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Paddle ${n}`, tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2500 } });
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${harbour.id}`, { quantity: 2 });
  const fee = await call(page, 'POST', '/fee_rules', { name: `Harbour delivery ${n}`, kind: 'delivery', calculation: 'flat', amount: 1500, mode: 'optional' });
  const day = weekday(30 + (n % 20));
  const from = `${day}T08:00:00.000Z`;
  const to = new Date(Date.parse(from) + 86400_000).toISOString();
  try {
    const shopper = await (await browser.newContext()).newPage();
    try {
      await shopper.goto(`${STORE}/`);
      await hydrated(shopper);
      expect((await shopper.request.post(`${STORE}/_or/dates`, { data: { from, to } })).ok()).toBe(true);

      // None at the default location: the product page names the harbour, and one click moves there.
      await shopper.goto(`${STORE}/p/${product.slug}`);
      await hydrated(shopper);
      const hint = shopper.getByTestId('available-elsewhere');
      await expect(hint).toContainText(`Free at Harbour ${n} for these dates`);
      await hint.getByRole('button', { name: `Pick up at Harbour ${n}` }).click();
      await expect(shopper.getByTestId('location-picker').getByRole('combobox')).toHaveValue(harbour.id);
      await expect(hint).toBeHidden();
      await shopper.getByRole('button', { name: 'Add to cart' }).click();
      await expect(shopper.locator('p[role="status"]', { hasText: 'Added to your cart' })).toBeVisible();

      // At checkout: pickup at the harbour, until delivery is chosen; then its times.
      await shopper.goto(`${STORE}/cart`);
      await hydrated(shopper);
      await shopper.getByRole('link', { name: /continue to checkout/i }).click();
      await shopper.waitForURL(/checkout/);
      await hydrated(shopper);
      await expect(shopper.getByTestId('pickup-at')).toContainText(`Pick up at Harbour ${n}`);
      await shopper.getByTestId('optional-fees').getByLabel(new RegExp(`Harbour delivery ${n}`)).click();
      await expect(shopper.getByTestId('optional-fees').getByLabel(new RegExp(`Harbour delivery ${n}`))).toBeChecked();
      const choice = shopper.getByTestId('delivery-choice');
      await choice.getByLabel(/^Delivery on/).selectOption('14:00-17:00');
      await choice.getByLabel(/^Collection on/).selectOption('09:00-12:00');
      expect(await serious(shopper, '[data-testid="delivery-choice"]'), 'delivery choice').toEqual([]);
      await shopper.getByLabel('Full name').fill('Harbour Shopper');
      await shopper.getByLabel('Email').fill(`harbour-${n}@example.com`);
      await shopper.getByLabel('I accept the rental terms').check();
      await shopper.getByRole('button', { name: /place booking/i }).click();
      await expect(shopper.getByRole('heading', { name: /thank you, your booking #\d+/i })).toBeVisible({ timeout: 15_000 });

      // The calendar file has the pickup and return.
      const calendar = shopper.getByTestId('order-calendar');
      const href = await calendar.getByRole('link', { name: 'Add to calendar' }).getAttribute('href');
      const ics = await (await shopper.request.get(new URL(href!, STORE).href)).text();
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
      expect(await serious(shopper, '[data-testid="order-calendar"]'), 'calendar links').toEqual([]);
      const number = Number(/#(\d+)/.exec((await shopper.getByRole('heading', { name: /thank you/i }).textContent()) ?? '')![1]);

      // Staff see the booking at the harbour, with the delivery in the chosen window.
      const order = await call(page, 'GET', `/orders/%23${number}`);
      expect(order.location_id).toBe(harbour.id);
      const deliveries = (await call(page, 'GET', `/deliveries?order_id=${order.id}`)).data;
      const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
      const d = deliveries.find((x: any) => x.kind === 'delivery');
      expect([time(d.window_start), time(d.window_end)]).toEqual(['14:00', '17:00']);
      await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
    } finally {
      await shopper.context().close();
    }
  } finally {
    await call(page, 'DELETE', `/fee_rules/${fee.id}`);
    await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${harbour.id}`, { quantity: 0 });
    await call(page, 'DELETE', `/locations/${harbour.id}`);
  }
  expect(errors).toEqual([]);
});
