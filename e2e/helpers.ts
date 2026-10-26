import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

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
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
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
