import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { test, ADMIN, ADMIN_STATE, shot } from './helpers.ts';

/**
 * Plain English admin texts (no placeholders): any of them on screen under en-XA skipped the catalogue.
 * The product name and language names (each shown in its own language) are the same in every language.
 */
const SAME_EVERYWHERE = new Set(['OpenRent', 'English', 'Deutsch', 'Français', 'Español', 'Eesti', '日本語', 'Nederlands']);
const english = new Set(
  Object.entries(
    JSON.parse(
      readFileSync(new URL('../apps/admin/src/lib/i18n/en.json', import.meta.url), 'utf8'),
    ) as Record<string, string>,
  )
    .filter(([k, v]) => !k.startsWith('_') && !v.includes('{') && v.length >= 4 && !SAME_EVERYWHERE.has(v))
    .map(([, v]) => v),
);

test('every admin text comes from the catalogue (pseudo-locale)', async ({ page }) => {
  await page.context().addCookies(JSON.parse(readFileSync(ADMIN_STATE, 'utf8')).cookies);
  const leaks: string[] = [];
  for (const path of [
    '/',
    '/orders',
    '/products',
    '/customers',
    '/inventory',
    '/maintenance',
    '/reports',
    '/settings',
    '/themes',
    '/plugins',
  ]) {
    await page.goto(`${ADMIN}${path}?locale=en-XA`);
    // The pseudo-translation brackets every message.
    await expect(page.locator('h1').first()).toContainText('⟦');
    const texts = await page.locator('body').evaluate((body) => {
      const out: string[] = [];
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('script,style,[aria-hidden="true"]') || !el.checkVisibility()) continue;
        const text = n.textContent?.trim();
        if (text) out.push(text);
      }
      // Attributes of hidden elements (inactive tabs, closed menus) are not on screen either.
      for (const el of body.querySelectorAll('[placeholder],[aria-label],[title]'))
        for (const a of el.checkVisibility() ? ['placeholder', 'aria-label', 'title'] : []) {
          const v = el.getAttribute(a)?.trim();
          if (v) out.push(v);
        }
      return out;
    });
    for (const text of texts) if (english.has(text)) leaks.push(`${path}: ${text}`);
    if (path === '/') await shot(page, 'admin-pseudo-locale');
  }
  expect(leaks).toEqual([]);
});
