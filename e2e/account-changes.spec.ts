import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test, messageHtml, ADMIN, STORE, collectErrors, hydrated, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

/** The `k`-th weekday after `day` (the demo shop is closed on Sundays). */
function weekdayAfter(day: string, k: number) {
  for (let d = 1; ; d++) {
    const dt = new Date(Date.parse(`${day}T00:00:00Z`) + d * 86400_000);
    if (dt.getUTCDay() >= 1 && dt.getUTCDay() <= 5 && --k === 0) return dt.toISOString().slice(0, 10);
  }
}

async function serious(page: Page, include: string) {
  await page.mouse.move(0, 0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(include).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);
}

test('a customer moves a booking to other days themselves and books an earlier one again', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await signIn(page);
  const n = Date.now() % 100000;
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Tent ${n}`, tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 3000 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location.id}`, { quantity: 3 });
  const email = `changes-${n}@example.com`;
  const customer = await call(page, 'POST', '/customers', { name: 'Chris Change', email });
  const at = (day: string) => `${day}T08:00:00.000Z`;
  // Monday to Thursday: from a Friday the booking spans the weekend, and the moved one would cost less.
  let start = weekday(40 + (n % 10));
  while (new Date(`${start}T00:00:00Z`).getUTCDay() === 5) start = weekdayAfter(start, 1);
  const booking = await call(page, 'POST', '/orders', { customer_id: customer.id, location_id: location.id, starts_at: at(start), ends_at: at(weekdayAfter(start, 1)), lines: [{ variant_id: product.variants[0].id, quantity: 1 }], deposit: { mode: 'none' } });
  await call(page, 'POST', `/orders/${booking.id}/actions/reserve`, { notify: false });
  // An earlier booking, returned, to book again.
  const past = await call(page, 'POST', '/orders', { customer_id: customer.id, location_id: location.id, starts_at: new Date(Date.now() - 5 * 86400_000).toISOString(), ends_at: new Date(Date.now() - 4 * 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 2 }], deposit: { mode: 'none' } });
  await call(page, 'POST', `/orders/${past.id}/actions/reserve`, { notify: false });
  await call(page, 'POST', `/orders/${past.id}/actions/check_out`, {});
  await call(page, 'POST', `/orders/${past.id}/actions/check_in`, { all: true });
  await call(page, 'PATCH', '/tenant/settings', { self_service: { change_dates: 'self', change_until_hours: 24 } });
  try {
    await call(page, 'POST', `/customers/${customer.id}/actions/send_portal_link`);
    const msg = (await call(page, 'GET', '/notifications?limit=50')).data.find((x: any) => x.template === 'portal_invitation' && x.recipient === email);
    const token = /token(?:=|&#x3D;)([\w-]+)/.exec(await messageHtml(msg.id))![1]!;
    const shopper = await (await browser.newContext()).newPage();
    try {
      await shopper.goto(`${STORE}/account/verify?token=${token}`);
      await hydrated(shopper);
      await shopper.getByRole('button', { name: 'Sign in' }).click();
      await expect(shopper).toHaveURL(/\/account$/);
      await hydrated(shopper);

      // Two days later, one day longer: the price is shown first.
      const card = shopper.getByTestId('account-self-service');
      const row = card.getByTestId('self-service-order');
      await row.getByRole('button', { name: 'Change dates' }).click();
      const newStart = weekdayAfter(start, 2);
      const newEnd = weekdayAfter(newStart, 2);
      await row.getByLabel('New pickup day').fill(newStart);
      await row.getByLabel('New return day').fill(newEnd);
      await row.getByRole('button', { name: 'Check price' }).click();
      await expect(row.getByTestId('self-service-preview')).toContainText('more, to pay in your account');
      expect(await serious(shopper, '[data-testid="account-self-service"]'), 'self-service card').toEqual([]);
      await row.getByRole('button', { name: 'Move the booking' }).click();
      await expect(card.getByText('Your booking has its new dates')).toBeVisible();
      const moved = await call(page, 'GET', `/orders/${booking.id}`);
      expect(moved.starts_at.slice(0, 10)).toBe(newStart);
      expect(moved.ends_at.slice(0, 10)).toBe(newEnd);

      // Book the earlier one again: its items are in the cart, dates to choose.
      const again = shopper.getByTestId('account-book-again');
      expect(await serious(shopper, '[data-testid="account-book-again"]'), 'book again card').toEqual([]);
      await again.getByRole('button', { name: 'Book again' }).first().click();
      await shopper.waitForURL(/\/cart/);
      await hydrated(shopper);
      await expect(shopper.getByTestId('cart-lines')).toContainText(`E2E Tent ${n}`);
    } finally {
      await shopper.context().close();
    }
  } finally {
    await call(page, 'PATCH', '/tenant/settings', { self_service: { change_dates: 'off', change_until_hours: 48 } });
    await call(page, 'POST', `/orders/${booking.id}/actions/cancel`, { notify: false });
  }
  expect(errors).toEqual([]);
});
