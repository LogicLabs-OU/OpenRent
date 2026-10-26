import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

/** A small PNG made in the browser, so the test needs no image files. */
async function pngBytes(page: Page, colour: string): Promise<Buffer> {
  const b64 = await page.evaluate((c) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 800, height: 600 });
    const g = canvas.getContext('2d')!;
    g.fillStyle = c;
    g.fillRect(0, 0, 800, 600);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }, colour);
  return Buffer.from(b64, 'base64');
}

test('staff add product photos, import a catalogue and request a payment', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);

  // Photos: upload to the sea kayak and see them on the storefront.
  await page.goto(`${ADMIN}/products`);
  await page.getByRole('link', { name: 'Sea kayak' }).click();
  const gallery = page.getByTestId('image-gallery');
  await expect(gallery).toBeVisible();
  const before = await gallery.locator('img').count();
  await gallery
    .getByTestId('image-input')
    .setInputFiles({ name: 'kayak.png', mimeType: 'image/png', buffer: await pngBytes(page, '#e11d48') });
  await expect(gallery.locator('img')).toHaveCount(before + 1);
  const alt = `Red sea kayak ${Date.now() % 10000}`;
  await gallery.getByLabel('Describe the photo').last().fill(alt);
  await gallery.getByLabel('Describe the photo').last().blur();
  // The alt text saves on change; wait for the saved photo before looking at the storefront.
  await expect(gallery.getByRole('img', { name: alt })).toBeAttached();
  await shot(page, 'admin-product-photos');

  const sf = await page.context().newPage();
  await sf.goto(`${STORE}/p/sea-kayak`);
  await hydrated(sf);
  await expect(sf.getByRole('img', { name: alt })).toBeAttached();
  // The photo really loads (CSP and the public file route both allow it).
  await expect
    .poll(async () =>
      sf
        .locator('img[src*="/public/files/"]')
        .first()
        .evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
    )
    .toBe(true);
  await sf.close();
  // Remove the photo again, so repeated runs against one database do not pile photos onto the kayak.
  await gallery
    .getByRole('listitem')
    .filter({ has: page.getByRole('img', { name: alt }) })
    .getByRole('button', { name: 'Remove' })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(gallery.locator('img')).toHaveCount(before);

  // Import: dry run shows the errors, a corrected file applies.
  await page.goto(`${ADMIN}/products`);
  await page.getByRole('button', { name: 'Import / export' }).click();
  await page.getByRole('menuitem', { name: 'Import from file…' }).first().click();
  const sku = `E2E-${Date.now() % 100000}`;
  const csv = `name;sku;price;category\nE2E tent ${sku};${sku};18,50;Camping\nBroken row;;abc;\n`;
  await page
    .getByTestId('import-input')
    .setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('import-summary')).toContainText('1 error');
  await expect(page.getByTestId('import-apply')).toBeDisabled();
  await shot(page, 'admin-import-report');
  await page.getByRole('button', { name: 'Other file' }).click();
  await page.getByTestId('import-input').setInputFiles({
    name: 'products.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv.split('\n').slice(0, 2).join('\n')),
  });
  await expect(page.getByTestId('import-summary')).toContainText('1 new');
  await page.getByTestId('import-apply').click();
  await expect(page.getByRole('link', { name: `E2E tent ${sku}` })).toBeVisible();

  // Payment link: request part of an order's balance.
  await page.goto(`${ADMIN}/orders`);
  await page.locator('table tbody tr').first().click();
  await page.getByRole('tab', { name: 'Payments' }).click();
  const request = page.getByRole('button', { name: 'Request payment' });
  if (await request.isVisible()) {
    await request.click();
    await page.getByLabel(/^Amount/).fill('1');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Send request|Create and copy link/ })
      .click();
    await expect(page.getByTestId('payment-request')).toContainText('Waiting for payment');
    await shot(page, 'admin-payment-request');
  }

  // Audit log lists the changes just made.
  await page.goto(`${ADMIN}/audit`);
  await expect(page.getByTestId('audit-table')).toContainText('add_image');
  await shot(page, 'admin-audit');
  expect(errors).toEqual([]);
});
