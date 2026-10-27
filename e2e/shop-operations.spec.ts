import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startPglite } from '../packages/db/src/dev/pglite-server.ts';
import { test, collectErrors } from './helpers.ts';

/**
 * A managed installation (many shops, sign-up open, an operator key) on its own database, API and
 * admin, so its shops never meet the single-shop test stack.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:7175';
const ADMIN = 'http://localhost:7176/admin';
const KEY = 'e2e-operator-key-0123456789abcdef';
let db: Awaited<ReturnType<typeof startPglite>>;
const procs: ChildProcess[] = [];

async function up(url: string, what: string) {
  for (let i = 0; i < 240; i++) {
    if (await fetch(url).then((r) => r.status < 500, () => false)) return;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`${what} did not start`);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  db = await startPglite({ port: 7433, maxConnections: 8 });
  const env = {
    ...process.env,
    DATABASE_URL: db.url, DATABASE_MIGRATION_URL: db.url, DATABASE_POOL_MAX: '4', PORT: '7175',
    OPENRENT_PUBLIC_URL: API, ADMIN_URL: ADMIN, STOREFRONT_URL: 'http://localhost:7177',
    OPENRENT_MODE: 'multi_tenant', OPENRENT_SIGNUP: '1', OPENRENT_OPERATOR_KEY: KEY,
    OPENRENT_DEFAULT_LIMITS: JSON.stringify({ orders_per_month: 50, storage_mb: 100 }),
    AUTO_MIGRATE: 'true', LOG_LEVEL: 'warn',
  };
  procs.push(spawn('npx', ['tsx', 'src/server.ts'], { cwd: path.join(ROOT, 'apps/api'), env, stdio: 'ignore' }));
  procs.push(spawn('npx', ['vite', 'dev', '--port', '7176', '--strictPort'], { cwd: path.join(ROOT, 'apps/admin'), env: { ...process.env, OPENRENT_API_URL: API, SVELTEKIT_OUT_DIR: '.svelte-kit-e2e-ops', VITE_CACHE_DIR: 'node_modules/.vite-e2e-ops' }, stdio: 'ignore' }));
  await up(`${API}/api/v1/system/health`, 'The API');
  await up(`${ADMIN}/login`, 'The admin');
  // The operator's own first shop, made at first run; sign-up is for every shop after it.
  const setup = await fetch(`${API}/api/v1/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner: { email: 'operator@example.com', password: 'operator-pass-1', name: 'Operator' }, tenant: { name: 'Operator', currency: 'EUR', timezone: 'Europe/Tallinn' }, location: { name: 'Office' } }),
  });
  expect(setup.status).toBe(201);
});
test.afterAll(async () => {
  for (const p of procs) p.kill();
  await db?.stop();
});

const axe = async (page: Page) => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
async function operator(method: string, url: string, data?: unknown) {
  const res = await fetch(`${API}/api/v1/operator${url}`, { method, headers: { 'x-operator-key': KEY, ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  expect(res.ok, `${method} ${url}: ${res.status}`).toBe(true);
  return res.json();
}

test('a rental shop signs up, sees its plan, and is suspended and resumed by the operator', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Open a shop' }).click();
  await expect(page.getByRole('heading', { name: 'Open a shop' }).or(page.getByText('Open a shop').first())).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Kai Owner');
  await page.getByLabel('Email').fill('kai@example.com');
  await page.getByLabel('Password').fill('kai-password-1');
  await page.getByLabel('Shop name').fill('Kai’s Kayaks');
  await axe(page);
  await page.getByRole('button', { name: 'Open the shop' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto(`${ADMIN}/settings`);
  const plan = page.getByTestId('plan-usage');
  await expect(plan).toContainText('Orders this month');
  await expect(plan).toContainText('0 of 50');
  await axe(page);

  const shop = (await operator('GET', '/shops')).data.find((s: any) => s.name === 'Kai’s Kayaks');
  expect(shop).toMatchObject({ slug: 'kai-s-kayaks', status: 'active', limits: { orders_per_month: 50, storage_mb: 100 } });
  await operator('POST', `/shops/${shop.id}/actions/suspend`, { reason: 'The trial ended.' });
  await page.reload();
  const suspended = page.getByTestId('shop-suspended');
  await expect(suspended).toContainText('Kai’s Kayaks is suspended');
  await expect(suspended).toContainText('The trial ended.');
  await axe(page);

  await operator('POST', `/shops/${shop.id}/actions/resume`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
  expect(errors.filter((e) => !/403|shop_suspended/.test(e))).toEqual([]);
});
