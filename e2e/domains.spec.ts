import { expect, test } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

test('staff add a custom domain, see the DNS records and remove it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=domains`);
  const card = page.getByTestId('domains');
  const host = `e2e-${Date.now()}.example.com`;
  await card.getByPlaceholder('shop.example.com').fill('not a domain');
  await card.getByRole('button', { name: 'Add domain' }).click();
  await expect(card.getByText('Enter a domain name like shop.example.com')).toBeVisible();

  await card.getByPlaceholder('shop.example.com').fill(host);
  await card.getByRole('button', { name: 'Add domain' }).click();
  const row = card.getByTestId('domain-row').filter({ hasText: host });
  await expect(row.getByText('Waiting for DNS')).toBeVisible();
  await expect(row.getByTestId('dns-txt')).toHaveValue(/^openrent-verify=/);
  await expect(row.getByText(`_openrent.${host}`)).toBeVisible();
  await shot(page, 'admin-domains');

  await row.getByRole('button', { name: 'Check now' }).click();
  await expect(row.getByText(/No TXT record at/)).toBeVisible();

  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});
