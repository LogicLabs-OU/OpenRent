import { expect, test, type Page } from '@playwright/test';
import { ADMIN, collectErrors, randomOffset, shot, signIn, weekday } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;
const day = 86400_000;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test('staff see new online bookings in the bell and choose what they are told about', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);

  // An online booking tells staff in the admin.
  const start = new Date(`${weekday(randomOffset())}T09:00:00.000Z`);
  const end = new Date(start.getTime() + day);
  const settings = await call(page, 'GET', '/storefront/settings');
  const catalog = await call(page, 'GET', `/storefront/catalog/products?from=${start.toISOString()}&to=${end.toISOString()}&limit=100`);
  const variant = catalog.data.flatMap((p: any) => p.variants).find((v: any) => v.price && (v.available ?? 1) > 0);
  const cart = await call(page, 'POST', '/storefront/checkout_sessions', { starts_at: start.toISOString(), ends_at: end.toISOString(), lines: [{ variant_id: variant.id, quantity: 1 }] });
  const done = await call(page, 'POST', `/storefront/checkout_sessions/${cart.id}/actions/complete`, { customer: { name: 'Bell Booker', email: `bell-${Date.now()}@example.com` }, terms_accepted: true, terms_hash: settings.terms.hash });
  const order = done.order;

  await page.reload();
  const bell = page.getByTestId('notification-bell');
  await expect(page.getByTestId('notification-count')).toBeVisible();
  await bell.click();
  const item = page.getByTestId('notification-item').filter({ hasText: `New online booking #${order.number} from Bell Booker` });
  await expect(item).toBeVisible();
  await shot(page, 'admin-notification-bell');
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  const mine = await call(page, 'GET', '/me/notifications');
  expect(mine.data.find((n: any) => n.entity_id === order.id).read_at).toBeTruthy();

  // Per-member settings: no low-availability emails.
  await bell.click();
  await page.getByTestId('notification-preferences').click();
  const dialog = page.getByRole('dialog', { name: 'Notification settings' });
  await expect(dialog.getByTestId('notification-pref')).toHaveCount(10);
  try {
    await dialog.getByRole('switch', { name: 'Low availability: Email' }).click();
    await expect.poll(async () => (await call(page, 'GET', '/me/notification_preferences')).kinds.find((k: any) => k.kind === 'staff_low_availability').email).toBe(false);
    await shot(page, 'admin-notification-preferences');
  } finally {
    await call(page, 'PATCH', '/me/notification_preferences', { kinds: [{ kind: 'staff_low_availability', email: true }] });
  }
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('staff set a low-availability alert per variant and pick the email provider', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Alert kayak ${Date.now()}`, visibility: 'hidden', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 2000 } });
  await page.goto(`${ADMIN}/products/${product.id}`);
  const rules = page.getByTestId('variant-rules');
  if (!(await rules.isVisible())) await page.getByRole('button', { name: 'Override', exact: true }).click();
  await rules.getByTestId('low-availability-threshold').fill('2');
  await rules.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await call(page, 'GET', `/products/${product.id}`)).variants[0].low_availability_threshold).toBe(2);

  await page.goto(`${ADMIN}/settings?tab=email`);
  const provider = page.getByLabel('Send email with');
  await expect(provider).toBeVisible();
  try {
    await provider.selectOption({ label: 'Postmark email' });
    await expect.poll(async () => (await call(page, 'GET', '/tenant/settings')).email_channel).toBe('notify-postmark');
    await expect(page.getByText('Enter the Postmark email settings on the Plugins page:')).toBeVisible();
    await shot(page, 'admin-email-provider');
  } finally {
    await call(page, 'PATCH', '/tenant/settings', { email_channel: null });
  }
  expect(errors).toEqual([]);
});
