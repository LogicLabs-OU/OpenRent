import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startTwilioFake } from '@openrent/messaging-fakes';
import { ADMIN, STORE, collectErrors, hydrated, randomOffset, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

// Booking updates by SMS (FR-NOT-4): the shop picks a plugin and tests it, rewrites a text, and
// customers opt in on their customer page or at checkout.
test('staff set up text messages and customers get their booking by SMS', async ({ page, browser }) => {
  const errors = collectErrors(page);
  const fake = await startTwilioFake();
  await signIn(page);
  const stamp = Date.now();
  await call(page, 'PATCH', '/plugins/notify-twilio', { enabled: true, config: { account_sid: fake.accountSid, auth_token: fake.authToken, from: '+15005550006', api_base_url: fake.url } });
  try {
    await page.goto(`${ADMIN}/settings?tab=email`);
    const card = page.getByTestId('text-messages');
    await card.getByLabel('Send SMS with').selectOption('notify-twilio');
    await expect(page.getByText('Saved').first()).toBeVisible();
    await card.getByLabel('Test number').fill('555 0101');
    await card.getByRole('button', { name: 'Send test' }).click();
    await expect(card.getByText('Enter the number with its country code')).toBeVisible();
    await card.getByLabel('Test number').fill('+44 7700 900123');
    await card.getByRole('button', { name: 'Send test' }).click();
    await expect(card.getByText('Test message sent to +447700900123')).toBeVisible();
    expect(fake.messages.at(-1)).toMatchObject({ to: '+447700900123', from: '+15005550006' });
    await page.mouse.move(0, 0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="text-messages"]').analyze();
    expect(axe.violations).toEqual([]);

    // The shop's own confirmation text.
    await page.getByRole('row').filter({ hasText: 'Booking confirmed' }).getByRole('button', { name: 'Edit' }).click();
    const text = page.getByLabel('Text message (SMS and WhatsApp)');
    await expect(text).toHaveValue(/\{\{order\.number\}\}/);
    await text.fill(`Booked #{{order.number}}, see you! ${stamp}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // A customer opts in on their page and gets the confirmation by SMS.
    const customer = await call(page, 'POST', '/customers', { name: `E2E Texter ${stamp}`, email: `texter-${stamp}@example.com`, phone: '+372 5550 2001' });
    const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Text kayak ${stamp}`, tracking: 'bulk', visibility: 'public', price: { kind: 'per_period', period_unit: 'day', amount: 4000 } });
    const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
    await call(page, 'PUT', `/stock_levels/${product.variants[0].id}/${location.id}`, { quantity: 10 });
    await page.goto(`${ADMIN}/customers/${customer.id}`);
    await page.getByLabel('Booking updates by SMS').click();
    await expect.poll(async () => (await call(page, 'GET', `/customers/${customer.id}`)).sms_opt_in).toBe(true);
    const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
    const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
    await call(page, 'POST', `/orders/${order.id}/actions/reserve`, {});
    const log = (await call(page, 'GET', `/notifications?order_id=${order.id}`)).data;
    expect(log.find((n: any) => n.channel === 'sms')).toMatchObject({ recipient: '+37255502001', text: `Booked #${order.number}, see you! ${stamp}` });
    await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });

    // At checkout the customer asks for texts.
    const shopper = await (await browser.newContext()).newPage();
    const from = new Date(start.getTime() + 3 * 86400_000);
    await shopper.request.post(`${STORE}/_or/dates`, { data: { from: from.toISOString(), to: new Date(from.getTime() + 86400_000).toISOString() } });
    await shopper.request.post(`${STORE}/_or/cart`, { data: { variant_id: product.variants[0].id, quantity: 1 } });
    // The storefront offers texts while the shop sends them; say why when it does not.
    await expect
      .poll(async () => (await (await shopper.request.get(`${API}/storefront/settings`)).json()).messaging?.sms, {
        message: JSON.stringify({ settings: (await call(page, 'GET', '/tenant/settings')).sms_channel, plugin: (await call(page, 'GET', '/plugins/notify-twilio')).enabled }),
      })
      .toBe(true);
    await shopper.goto(`${STORE}/checkout`);
    await hydrated(shopper);
    const email = `web-texter-${stamp}@example.com`;
    await shopper.getByLabel('Full name').fill('Web Texter');
    await shopper.getByLabel('Email').fill(email);
    await shopper.getByLabel('Phone').fill('+372 5550 2002');
    await shopper.getByTestId('checkout-text-updates').getByLabel('Send me updates by text message').click();
    await shopper.getByLabel('I accept the rental terms').check();
    await shopper.getByRole('button', { name: /place booking/i }).click();
    await expect(shopper.getByRole('heading', { name: /thank you, your booking #\d+/i })).toBeVisible({ timeout: 15_000 });
    await shopper.context().close();
    const web = (await call(page, 'GET', `/customers?q=${encodeURIComponent(email)}`)).data[0];
    expect(web).toMatchObject({ sms_opt_in: true, phone: '+372 5550 2002' });
    for (const o of (await call(page, 'GET', `/customers/${web.id}/orders?limit=5`)).data) await call(page, 'POST', `/orders/${o.id}/actions/cancel`, { notify: false });
    expect(errors).toEqual([]);
  } finally {
    await call(page, 'PATCH', '/notification_templates/order_confirmed', { locale: 'en', text: null });
    await call(page, 'PATCH', '/tenant/settings', { sms_channel: null });
    await call(page, 'PATCH', '/plugins/notify-twilio', { enabled: false });
    await fake.close();
  }
});
