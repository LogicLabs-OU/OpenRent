import { expect } from '@playwright/test';
import { test, ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

const API = `${new URL(ADMIN).origin}/api/v1`;

test('customers search the catalogue and filter by category in both themes', async ({
  page,
  browser,
}, info) => {
  const errors = collectErrors(page);
  await page.goto(STORE);
  await hydrated(page);
  // Wide screens have a search box in the header; small ones a search button.
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const box = page.getByRole('search').getByRole('searchbox', { name: 'Search the shop' });
    await box.fill('kayak');
    await box.press('Enter');
  } else {
    await page.getByRole('link', { name: 'Search the shop' }).click();
    await page.getByRole('searchbox', { name: 'Search the shop' }).fill('kayak');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/search\?q=kayak/);
  await expect(page.getByRole('heading', { name: 'Results for “kayak”' })).toBeVisible();
  await expect(page.getByTestId('product-card').filter({ hasText: 'Sea kayak' })).toBeVisible();
  await hydrated(page);
  await page.getByLabel('Category').selectOption({ label: 'Bikes' });
  await expect(page).toHaveURL(/category=bikes/);
  await expect(page.getByTestId('search-count')).toHaveText('0 products');
  await expect(page.getByText('Nothing matches your search.')).toBeVisible();
  await shot(page, `sf-search-${info.project.name}`);
  expect(errors).toEqual([]);

  // The Retro theme through a preview link (the live theme stays as it is).
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin);
  const csrf = (await admin.context().cookies()).find((c) => c.name === 'or_csrf')?.value ?? '';
  const preview = await (
    await admin.request.post(`${API}/themes/retro/actions/preview`, { headers: { 'x-csrf-token': csrf } })
  ).json();
  const retro = await (await browser.newContext({ viewport: page.viewportSize() ?? undefined })).newPage();
  await retro.goto(preview.url);
  await retro.goto(`${STORE}/search?q=bike`);
  await expect(retro.getByRole('status').filter({ hasText: /Previewing the Retro theme/ })).toBeVisible();
  await expect(retro.getByRole('heading', { name: 'Results for “bike”' })).toBeVisible();
  const pills = retro.getByRole('group', { name: 'Category' });
  await pills.getByRole('link', { name: 'Bikes' }).click();
  await expect(retro).toHaveURL(/category=bikes/);
  await expect(pills.getByRole('link', { name: 'Bikes' })).toHaveAttribute('aria-current', 'true');
  await shot(retro, `sf-retro-search-${info.project.name}`);
});
