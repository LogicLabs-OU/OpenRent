import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

/**
 * The tests' `test`: after each one, browser contexts it opened besides its own (a shopper, a second
 * staff member) are closed, even when it failed, so they do not pile up in the worker's browser.
 */
export const test = base.extend<{ closeExtraContexts: void }>({
  closeExtraContexts: [
    async ({ browser, context }, use) => {
      await use();
      for (const c of browser.contexts()) if (c !== context) await c.close().catch(() => undefined);
    },
    { auto: true },
  ],
});

export const ADMIN = (process.env.ADMIN_URL ?? 'http://localhost:7071/admin').replace(/\/$/, '');
export const STORE = (process.env.STOREFRONT_URL ?? 'http://localhost:7072').replace(/\/$/, '');
export const SHOTS = process.env.E2E_SCREENSHOTS;
/** Staff session saved by global-setup.ts. */
export const ADMIN_STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth', 'admin.json');

/** Opens the admin with the run's staff session (signed in once in global-setup.ts). */
export async function signIn(page: Page) {
  await page.context().addCookies(JSON.parse(readFileSync(ADMIN_STATE, 'utf8')).cookies);
  await page.goto(ADMIN);
  // The admin dev server compiles pages on first use; a busy machine needs more than the default 5 s.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({ timeout: 15_000 });
}

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Trace recording cannot script sandboxed frames (email previews, the document on the signing page);
    // Chromium logs that as an error.
    if (/Blocked script execution in .* frame is sandboxed/.test(m.text())) return;
    if (
      m.type() === 'error' &&
      !/favicon|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())
    )
      errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function shot(page: Page, name: string) {
  // The visible window: full-page captures draw sticky headers and sidebars in the wrong place.
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

export const isoDate = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

/** Next date at least `days` ahead that falls on a weekday (the demo shop is closed on Sundays). */
export function weekday(days: number) {
  for (let d = days; ; d++) {
    const dt = new Date(Date.now() + d * 86400_000);
    if (dt.getUTCDay() >= 1 && dt.getUTCDay() <= 5) return dt.toISOString().slice(0, 10);
  }
}

/** A random offset so repeated runs against one database do not exhaust stock for the same dates. */
export const randomOffset = () => 20 + Math.floor(Math.random() * 300);

/** `YYYY-MM-DDTHH:MM` wall-clock time in a time zone, offset by minutes from now (for datetime-local inputs). */
export function localInput(tz: string, offsetMin: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(Date.now() + offsetMin * 60_000))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** SvelteKit pages are server-rendered; wait until the client app has hydrated before typing. */
export async function hydrated(page: import('@playwright/test').Page) {
  await page.waitForSelector('body[data-hydrated="1"]', { timeout: 15_000 });
}

/** Picks a day (YYYY-MM-DD) in a shadcn/bits-ui calendar inside `scope`, paging forward month by month. */
export async function pickDay(scope: import('@playwright/test').Locator, date: string) {
  const day = scope.locator(`[data-bits-day][data-value="${date}"]:not([data-outside-month])`);
  for (let i = 0; i < 24 && !(await day.isVisible()); i++)
    await scope.getByRole('button', { name: 'Next' }).click();
  await day.click();
}

/** Adds a product in an order editor: searches by `search` and picks the result named `option` (default the same). */
export async function addProduct(page: Page, search: string, option = search) {
  const picker = page.getByTestId('product-picker');
  await picker.getByLabel('Add a product').fill(search);
  await picker.getByRole('option', { name: option, exact: true }).click();
  await expect(picker.getByLabel('Add a product')).toHaveValue('');
}

/**
 * The HTML of a queued message that the message log hides (sign-in links, signing codes). The e2e stack
 * runs no worker, so messages stay queued; tests read them from the test database, never through the API.
 */
export async function messageHtml(id: string): Promise<string> {
  const { default: pg } = await import('pg');
  // The test database (PGlite behind a socket) can mix up statements of clients that connect at the
  // same moment, as parallel specs do; a fresh connection then reads fine.
  for (let attempt = 1; ; attempt++) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:7432/postgres' });
    try {
      await c.connect();
      const r = await c.query(`SELECT body_html FROM notifications WHERE id = $1`, [id]);
      return String(r.rows[0]?.body_html ?? '');
    } catch (err) {
      if (attempt >= 3 || !/prepared statement|portal/i.test(String((err as Error).message))) throw err;
      await new Promise((ok) => setTimeout(ok, 200 * attempt));
    } finally {
      await c.end().catch(() => undefined);
    }
  }
}
