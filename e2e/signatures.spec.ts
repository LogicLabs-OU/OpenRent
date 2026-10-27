import { expect, type Page } from '@playwright/test';
import { test, messageHtml, ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

/** Calls the API with the signed-in staff session (CSRF header included). */
async function call(page: Page, method: 'GET' | 'POST', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

/** The newest queued email of a template to this address, as HTML. */
async function mail(page: Page, template: string, to: string) {
  const log = await call(page, 'GET', '/notifications?limit=50');
  const n = log.data.find((x: any) => x.template === template && x.recipient === to);
  expect(n, `${template} to ${to}`).toBeTruthy();
  return (await messageHtml(n.id)).replace(/&#x3D;/g, '=').replace(/&amp;/g, '&');
}

test('staff ask for a signature and the customer signs with the emailed code', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const stamp = Date.now();
  const email = `pw-sign-${stamp}@example.com`;
  const customer = await call(page, 'POST', '/customers', { name: 'Sam Signer', email });
  const product = await call(page, 'POST', '/products', { type: 'rental', name: `Sign tent ${stamp % 100000}`, visibility: 'hidden', tracking: 'none', price: { kind: 'per_period', period_unit: 'day', amount: 1000 } });
  const start = new Date(Date.now() + 30 * 86400_000);
  const order = await call(page, 'POST', '/orders', { customer_id: customer.id, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 86400_000).toISOString(), lines: [{ variant_id: product.variants[0].id, quantity: 1 }] });
  await call(page, 'POST', `/orders/${order.id}/documents`, { type: 'contract' });

  await page.goto(`${ADMIN}/orders/${order.id}`);
  await page.getByRole('button', { name: 'Ask the customer to sign' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `Signing link sent to ${email}` }).last()).toBeVisible();
  await expect(page.getByText('Awaiting signature')).toBeVisible();
  const token = /\/sign\/([A-Za-z0-9_-]+)/.exec(await mail(page, 'signature_requested', email))![1]!;

  const signer = await (await browser.newContext()).newPage();
  const signerErrors = collectErrors(signer);
  await signer.goto(`${STORE}/sign/${token}`);
  await hydrated(signer);
  await expect(signer.getByRole('heading', { name: 'Sign: Rental agreement' })).toBeVisible();
  await expect(signer.frameLocator('iframe').locator('body')).toContainText(`${order.number}`);
  await signer.getByRole('button', { name: 'Email me a code' }).click();
  const form = signer.getByTestId('sign-form');
  await expect(form).toBeVisible();
  const code = /letter-spacing:6px">(\d{6})</.exec(await mail(page, 'signature_code', email))![1]!;
  // A wrong code is answered next to the field.
  await form.getByLabel('Code').fill(code === '000000' ? '111111' : '000000');
  await form.getByLabel(/I have read the Rental agreement/).check();
  await form.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(form.getByText(/tries left/)).toBeVisible();
  await form.getByLabel('Code').fill(code);
  await expect(form.getByLabel('Your full name')).toHaveValue('Sam Signer');
  await shot(signer, 'sf-sign');
  await form.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(signer.getByText('Signed. Thank you!')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Signed', { exact: true })).toBeVisible();
  // The signed PDF is the issued pages plus a signature page.
  const doc = (await call(page, 'GET', `/documents?order_id=${order.id}&type=contract`)).data[0];
  const sig = (await call(page, 'GET', `/documents/${doc.id}/signatures`)).signatures[0];
  expect(sig).toMatchObject({ has_pdf: true, method: 'typed' });
  const pages = async (path: string) => {
    const body = await (await page.request.get(`${API}${path}`)).body();
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    return (body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  };
  expect(await pages(`/signatures/${sig.id}/pdf`)).toBe((await pages(`/documents/${doc.id}/pdf`)) + 1);
  expect(errors).toEqual([]);
  expect(signerErrors).toEqual([]);
});
