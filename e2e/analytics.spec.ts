import { expect } from '@playwright/test';
import { test, STORE, collectErrors, hydrated } from './helpers.ts';

// Analytics events (FR-SF-8): they wait for consent, then a product view and an item added go out.
test('the storefront sends analytics events only after consent', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    (window as any).__events = [];
    window.addEventListener('openrent:analytics', (e) => (window as any).__events.push((e as CustomEvent).detail.name));
  });
  const shopper = await ctx.newPage();
  const errors = collectErrors(shopper);
  // Without consent nothing is sent.
  await shopper.goto(`${STORE}/p/sea-kayak`);
  await hydrated(shopper);
  await expect(shopper.getByRole('heading', { name: 'Sea kayak' })).toBeVisible();
  expect(await shopper.evaluate(() => (window as any).__events)).toEqual([]);

  await ctx.addCookies([{ name: 'or_consent', value: 'all', url: STORE }]);
  await shopper.reload();
  await hydrated(shopper);
  await expect.poll(() => shopper.evaluate(() => (window as any).__events)).toEqual(['view_item']);
  expect(errors).toEqual([]);
});
