import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { epc, sendReads } from '@openrent/rfid-fakes';
import { test, ADMIN, collectErrors, settled, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

async function serious(page: Page, include: string) {
  await page.mouse.move(0, 0);
  await settled(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(include).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);
}

test('staff add a reader, and a whole read of tagged chairs goes out and comes back at once', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const readerName = `E2E Dock ${stamp}`;
  // Readers an interrupted earlier run left behind (not one a test running now has just added).
  for (const r of (await call(page, 'GET', '/rfid/readers')).data)
    if (/^E2E /.test(r.name) && Date.now() - Date.parse(r.created_at) > 10 * 60_000) await call(page, 'DELETE', `/rfid/readers/${r.id}`);

  // The reader, added in Settings: its address and token are shown once.
  await page.goto(`${ADMIN}/settings?tab=rfid`);
  const readers = page.getByTestId('rfid-readers');
  await readers.getByRole('button', { name: 'New reader' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(readerName);
  await dialog.getByLabel('Format').selectOption({ label: 'Zebra IoT Connector (HTTP POST)' });
  await dialog.getByRole('button', { name: 'Create' }).click();
  const url = await dialog.getByTestId('rfid-url').inputValue();
  const token = await dialog.getByTestId('rfid-token').inputValue();
  expect(url).toMatch(/\/webhooks\/rfid\/rfr_/);
  expect(await serious(page, '[role="dialog"]'), 'reader dialog').toEqual([]);
  await dialog.getByRole('button', { name: 'Done' }).click();
  const readerId = url.split('/').pop()!;

  // Three chairs, each with a tag.
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `E2E Chair ${stamp}`, tracking: 'serialized', visibility: 'hidden', price: { kind: 'per_period', period_unit: 'day', amount: 300 } });
  const location = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  const tags: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const unit = await call(page, 'POST', '/stock_items', { variant_id: product.variants[0].id, location_id: location.id, barcode: `RF-${stamp}-${i}` });
    const tag = epc();
    tags.push(tag);
    await call(page, 'PUT', `/stock_items/${unit.id}/rfid_tags`, { epcs: [tag] });
  }
  const customer = await call(page, 'POST', '/customers', { name: 'Chair Hire', email: `chairs-${stamp}@example.com` });
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, location_id: location.id, starts_at: new Date(Date.now() + 5 * 60_000).toISOString(), ends_at: new Date(Date.now() + 5 * 3600_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 3 }], deposit: { mode: 'none' } });
  await call(page, 'POST', `/orders/${order.id}/actions/reserve`, { notify: false });

  try {
    await page.goto(`${ADMIN}/scan`);
    await page.getByRole('radio', { name: 'Pick up' }).click();
    const input = page.getByLabel('Type or scan a code');
    await input.fill(String(order.number));
    await input.press('Enter');
    await expect(page.getByTestId('scan-order')).toContainText(`Order #${order.number}`);

    const panel = page.getByTestId('rfid-panel');
    const choose = panel.getByLabel('Reader');
    // The panel shows once it has the readers; other tests' readers may be there too.
    await expect(panel).toBeVisible();
    if (await choose.count()) await choose.selectOption({ label: readerName });
    await panel.getByRole('button', { name: 'Start reading' }).click();
    // Reading counts from when it started (the server's time): wait for that before the tags come.
    await expect(panel.getByTestId('rfid-counts')).toHaveText('0 units read, 0 tags not known');
    // The chairs, read several times each, and a tag that belongs to nothing.
    expect((await sendReads(url, token, 'zebra-iot', [...tags, epc()], { repeats: 3 })).status).toBe(200);
    await expect(panel.getByTestId('rfid-counts')).toHaveText('3 units read, 1 tag not known');
    expect(await serious(page, '[data-testid="rfid-panel"]'), 'rfid panel').toEqual([]);
    await shot(page, 'admin-rfid-read');
    await panel.getByRole('button', { name: 'Add 3 units to the order' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '3 units added' }).last()).toBeVisible();
    const assigned = (await call(page, 'GET', `/orders/${order.id}`)).lines[0].units.map((u: any) => u.barcode).sort();
    expect(assigned).toEqual([1, 2, 3].map((i) => `RF-${stamp}-${i}`));

    // Back at the counter: one read checks them all in.
    await call(page, 'POST', `/orders/${order.id}/actions/check_out`, {});
    await page.mouse.move(0, 0);
    await page.getByRole('radio', { name: 'Check in returns' }).click();
    await expect(panel).toBeVisible();
    if (await choose.count()) await choose.selectOption({ label: readerName });
    await panel.getByRole('button', { name: 'Start reading' }).click();
    await expect(panel.getByTestId('rfid-counts')).toHaveText('0 units read, 0 tags not known');
    await sendReads(url, token, 'zebra-iot', tags, { repeats: 2 });
    await expect(panel.getByTestId('rfid-counts')).toHaveText('3 units read, 0 tags not known');
    await panel.getByRole('button', { name: 'Check in 3 units' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '3 units checked in' }).last()).toBeVisible();
    expect((await call(page, 'GET', `/orders/${order.id}`)).status).toBe('returned');
  } finally {
    const o = await call(page, 'GET', `/orders/${order.id}`);
    if (o.status === 'out') await call(page, 'POST', `/orders/${order.id}/actions/check_in`, { all: true });
    if (o.status === 'reserved') await call(page, 'POST', `/orders/${order.id}/actions/cancel`, { notify: false });
    await call(page, 'DELETE', `/rfid/readers/${readerId}`);
  }
  expect(errors).toEqual([]);
});
