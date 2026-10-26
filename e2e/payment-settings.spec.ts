import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, collectErrors, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

async function call(page: Page, method: 'GET' | 'PATCH', path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, ...(data === undefined ? {} : { 'content-type': 'application/json' }) } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

// Every installed payment provider has its own card with the plugin's settings (Stripe, Mollie, PayPal).
test('staff set up a payment provider from its card', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=payments`);
  const cards = page.getByTestId('payment-provider');
  await expect(cards).toHaveCount(3);
  const mollie = cards.filter({ has: page.getByText('Mollie', { exact: true }) });
  await expect(mollie.getByText('Not set up')).toBeVisible();
  try {
    await mollie.getByLabel('API key').fill('test_e2eplaceholderkey1234567890');
    await mollie.getByRole('button', { name: 'Save keys' }).click();
    await expect(page.getByText('Mollie settings saved')).toBeVisible();
    await expect(mollie.getByLabel('API key')).toHaveAttribute('placeholder', 'Set; type to replace');
    await expect(mollie.getByLabel('API key')).toHaveValue('');
    expect((await call(page, 'GET', '/payment_providers')).data.find((p: any) => p.id === 'mollie').configured).toBe(true);
    // Not on a hovered button: axe checks the colours at rest.
    await page.mouse.move(0, 0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include('[data-testid="payment-provider"]').analyze();
    expect(axe.violations).toEqual([]);
  } finally {
    // Leave the shop without an online provider, as the other specs expect.
    await call(page, 'PATCH', '/payment_providers/mollie', { config: { api_key: null } });
  }
  expect(errors).toEqual([]);
});
