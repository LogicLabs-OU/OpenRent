import { expect, test, type Page } from '@playwright/test';
import { ADMIN, addProduct, collectErrors, localInput, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

async function archive(page: Page, name: string) {
  await page.getByTestId('location-row').filter({ hasText: name }).getByRole('button', { name: `Archive ${name}?` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${name} archived` }).last()).toBeVisible();
}

test('staff add a second location with its own details, switch the admin to it, then archive and restore it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const name = `Harbour ${Date.now() % 100000}`;
  await page.goto(`${ADMIN}/settings?tab=hours`);
  // The old tab link now opens Locations.
  await expect(page.getByRole('tab', { name: 'Locations' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'New location' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByLabel('Street and number').fill('Sadama 25');
  await sheet.getByLabel('City').fill('Tallinn');
  await sheet.getByLabel('Time zone').selectOption('Europe/Helsinki');
  await sheet.getByLabel('Phone').fill('+372 600 1234');
  await sheet.getByLabel('Email').fill('not-an-email');
  await sheet.getByRole('button', { name: 'Create location' }).click();
  // A wrong email is shown next to its field.
  await expect(sheet.getByText('Enter a valid email address')).toBeVisible();
  await sheet.getByLabel('Email').fill('harbour@example.com');
  await sheet.getByLabel('Tax ID').fill('EE101010101');
  await sheet.getByRole('button', { name: 'Create location' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${name} created` }).last()).toBeVisible();
  const row = page.getByTestId('location-row').filter({ hasText: name });
  await expect(row).toContainText('Europe/Helsinki');
  // The new location is selected: its opening hours card follows.
  await expect(page.getByText(`Opening hours · ${name}`)).toBeVisible();
  await page.getByRole('switch', { name: 'Sunday' }).click();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();
  await shot(page, 'admin-locations');

  try {
    // An order at the main shop, to see the header switcher filter the list.
    const main = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
    const product = await call(page, 'POST', '/products', { type: 'rental', name: `Switch tent ${Date.now()}`, visibility: 'hidden', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } });
    const customer = await call(page, 'POST', '/customers', { name: 'Switch Customer', email: `pw-switch-${Date.now()}@example.com` });
    const start = new Date(Date.now() + 40 * 86400_000);
    const order = await call(page, 'POST', '/orders', { customer_id: customer.id, location_id: main.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });

    // The header switcher appears once there is a second location.
    await page.goto(`${ADMIN}/orders?q=${order.number}`);
    const switcher = page.getByTestId('location-switcher');
    await expect(switcher).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `#${order.number}` })).toBeVisible();
    await switcher.selectOption({ label: name });
    await expect(page.getByText('No orders here')).toBeVisible();
    // The choice is remembered, and new orders start at that location.
    await page.reload();
    await expect(page.getByTestId('location-switcher')).toHaveValue(/^loc_/);
    await expect(page.getByText('No orders here')).toBeVisible();
    await page.goto(`${ADMIN}/orders/new`);
    await expect(page.getByLabel('Location', { exact: true })).toHaveValue(await page.getByTestId('location-switcher').inputValue());
    await page.getByTestId('location-switcher').selectOption({ label: 'All locations' });
    await call(page, 'POST', `/orders/${order.id}/actions/cancel`, {});
  } finally {
    await page.goto(`${ADMIN}/settings?tab=locations`);
    await archive(page, name);
  }
  await expect(page.getByTestId('location-row').filter({ hasText: name })).toHaveCount(0);
  // Archived locations are listed below and can come back.
  const archived = page.getByTestId('archived-locations').locator('li').filter({ hasText: name });
  await archived.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${name} restored` }).last()).toBeVisible();
  await expect(page.getByTestId('location-row').filter({ hasText: name })).toBeVisible();
  await archive(page, name);
  await expect(page.getByTestId('location-switcher')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('staff plan a transfer, send it, and receive it by scanning and on the transfer', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const main = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  const branch = await call(page, 'POST', '/locations', { name: `Depot ${stamp}`, opening_hours: {} });
  const cam = await call(page, 'POST', '/products', { type: 'rental', name: `Travel camera ${stamp}`, visibility: 'hidden', tracking: 'serialized', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } });
  const unit = await call(page, 'POST', '/stock_items', { variant_id: cam.variants[0].id, location_id: main.id, barcode: `TRV-${stamp}` });
  const chairs = await call(page, 'POST', '/products', { type: 'rental', name: `Travel chairs ${stamp}`, visibility: 'hidden', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 200 } });
  await call(page, 'PUT', `/stock_levels/${chairs.variants[0].id}/${main.id}`, { quantity: 10 });
  try {
    await page.goto(`${ADMIN}/inventory`);
    await page.getByRole('link', { name: 'Transfers' }).click();
    await expect(page.getByRole('heading', { name: 'Transfers', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New transfer' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('From').selectOption({ label: main.name });
    await sheet.getByLabel('To', { exact: true }).selectOption({ label: branch.name });
    await sheet.getByLabel('Add a unit').fill(unit.barcode);
    await sheet.getByLabel('Add a unit').press('Enter');
    await sheet.getByLabel('Add a bulk product').fill(`Travel chairs ${stamp}`);
    await sheet.getByRole('button', { name: `Travel chairs ${stamp}` }).click();
    await sheet.getByLabel(`Quantity of Travel chairs ${stamp}`).fill('20');
    await sheet.getByRole('button', { name: 'Plan transfer' }).click();
    // More than the shop has (a 409, shown as a toast).
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `Only 10 Travel chairs ${stamp} are available` }).last()).toBeVisible();
    await sheet.getByLabel(`Quantity of Travel chairs ${stamp}`).fill('4');
    await sheet.getByRole('button', { name: 'Plan transfer' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: /Transfer #\d+ planned/ }).last()).toBeVisible();

    const detail = page.getByTestId('transfer-sheet');
    await expect(detail).toContainText('Planned');
    await detail.getByRole('button', { name: 'Send now' }).click();
    await expect(detail).toContainText('In transit');
    expect((await call(page, 'GET', `/stock_items/${unit.id}`)).status).toBe('in_transit');
    await shot(page, 'admin-transfer');

    // The unit is scanned in at the depot.
    await detail.getByRole('link', { name: 'Receive by scanning' }).click();
    await page.getByRole('radio', { name: 'Receive' }).click();
    await expect(page.getByTestId('scan-receive')).toContainText('5 still coming');
    await page.getByLabel('Type or scan a code').fill(unit.barcode);
    await page.getByLabel('Type or scan a code').press('Enter');
    await expect(page.locator('[data-tone="ok"]').first()).toContainText(`Travel camera ${stamp} received`);
    expect((await call(page, 'GET', `/stock_items/${unit.id}`)).status).toBe('available');

    // Three chairs arrive; the fourth is written off.
    await page.goto(`${ADMIN}/inventory/transfers`);
    await page.getByTestId('transfer-row').filter({ hasText: `Depot ${stamp}` }).click();
    await detail.getByLabel(`Arrived: Travel chairs ${stamp}`).fill('3');
    await detail.getByRole('button', { name: 'Close and write off the rest' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close and write off the rest' }).click();
    await expect(detail).toContainText('Received');
    await expect(detail).toContainText('1 lost');
    const levels = (await call(page, 'GET', `/stock_levels?variant_id=${chairs.variants[0].id}`)).data;
    expect(Object.fromEntries(levels.map((l: any) => [l.location_id, l.quantity]))).toEqual({ [main.id]: 6, [branch.id]: 3 });
  } finally {
    // Back to one location for the other tests.
    for (const t of (await call(page, 'GET', `/transfers?status=planned&location_id=${branch.id}`)).data) await call(page, 'POST', `/transfers/${t.id}/actions/cancel`, {});
    const u = await call(page, 'GET', `/stock_items/${unit.id}`);
    if (u.location_id === branch.id && u.status === 'available') await call(page, 'POST', `/stock_items/${unit.id}/actions/transfer`, { to_location_id: main.id, received: true });
    await call(page, 'PUT', `/stock_levels/${chairs.variants[0].id}/${branch.id}`, { quantity: 0 });
    const del = await page.request.fetch(`${API}/locations/${branch.id}`, { method: 'DELETE', headers: { 'x-csrf-token': (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '' } });
    expect(del.ok(), await del.text()).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('a short order line shows the other locations and plans a transfer from one of them', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now() % 100000;
  const main = (await call(page, 'GET', '/locations')).data.find((l: any) => l.is_default);
  const depot = await call(page, 'POST', '/locations', { name: `Annex ${stamp}`, opening_hours: {} });
  const chairs = await call(page, 'POST', '/products', { type: 'rental', name: `Spare chairs ${stamp}`, visibility: 'hidden', tracking: 'bulk', price: { kind: 'per_period', period_unit: 'day', amount: 200 } });
  const v = chairs.variants[0];
  const label = v.name === chairs.name ? chairs.name : `${chairs.name} – ${v.name}`;
  await call(page, 'PUT', `/stock_levels/${v.id}/${main.id}`, { quantity: 1 });
  await call(page, 'PUT', `/stock_levels/${v.id}/${depot.id}`, { quantity: 5 });
  try {
    await page.goto(`${ADMIN}/orders/new`);
    await page.getByLabel('Location', { exact: true }).selectOption({ label: main.name });
    await page.getByLabel(/^Pickup/).fill(localInput('Europe/Tallinn', 3 * 24 * 60));
    await page.getByLabel(/^Return/).fill(localInput('Europe/Tallinn', 4 * 24 * 60));
    await addProduct(page, chairs.name, label);
    await page.getByLabel('Quantity').last().fill('3');
    await expect(page.getByText('Short by 2')).toBeVisible();
    await page.getByRole('button', { name: 'Other locations' }).click();
    const pop = page.getByTestId('availability-elsewhere');
    await expect(pop).toContainText(`Annex ${stamp}`);
    await expect(pop).toContainText('5 free');
    await pop.getByRole('link', { name: 'Transfer here' }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'New transfer' })).toBeVisible();
    await expect(sheet.getByLabel('From')).toHaveValue(depot.id);
    await expect(sheet.getByLabel('To', { exact: true })).toHaveValue(main.id);
    await expect(sheet.getByLabel(`Quantity of ${label}`)).toHaveValue('2');
    await sheet.getByRole('button', { name: 'Plan transfer' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: /Transfer #\d+ planned/ }).last()).toBeVisible();
  } finally {
    for (const t of (await call(page, 'GET', `/transfers?status=planned&location_id=${depot.id}`)).data) await call(page, 'POST', `/transfers/${t.id}/actions/cancel`, {});
    await call(page, 'PUT', `/stock_levels/${v.id}/${depot.id}`, { quantity: 0 });
    const del = await page.request.fetch(`${API}/locations/${depot.id}`, { method: 'DELETE', headers: { 'x-csrf-token': (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '' } });
    expect(del.ok(), await del.text()).toBe(true);
  }
  expect(errors).toEqual([]);
});
