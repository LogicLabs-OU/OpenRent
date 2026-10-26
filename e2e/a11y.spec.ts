import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STORE, hydrated, signIn } from './helpers.ts';

const WIDGET = process.env.WIDGET_URL ?? 'http://localhost:7173';

/** Serious and critical WCAG 2.1 A/AA problems on a page; minor ones are reported by axe but not failed on. */
async function problems(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} ${n.html.slice(0, 200)}`).join('\n    ')}`);
}

const ADMIN_PAGES = ['/', '/orders', '/orders/new', '/products', '/pricing', '/pricing?tab=coupons', '/inventory', '/customers', '/scan', '/maintenance', '/reports', '/themes', '/plugins', '/settings', '/settings?tab=email', '/audit'];

test('back office pages have no serious accessibility problems', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const found: string[] = [];
  for (const path of ADMIN_PAGES) {
    await page.goto(`${ADMIN}${path}`);
    await page.waitForLoadState('networkidle');
    for (const p of await problems(page)) found.push(`${path}: ${p}`);
  }
  expect(found, found.join('\n')).toEqual([]);
});

test('storefront pages have no serious accessibility problems', async ({ page }) => {
  test.setTimeout(120_000);
  const found: string[] = [];
  for (const path of ['/', '/search', '/p/sea-kayak', '/cart', '/account/login']) {
    await page.goto(`${STORE}${path}`);
    await hydrated(page);
    for (const p of await problems(page)) found.push(`${path}: ${p}`);
  }
  expect(found, found.join('\n')).toEqual([]);
});

test('the widget has no serious accessibility problems', async ({ page }) => {
  await page.goto(WIDGET);
  await expect(page.locator('openrent-product').getByText('Sea kayak')).toBeVisible();
  await expect(page.locator('openrent-category [data-product]').first()).toBeVisible();
  expect(await problems(page)).toEqual([]);
});
