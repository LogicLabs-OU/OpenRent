import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { runCLI } from '@wp-playground/cli';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

// By address, not name: WordPress's PHP and the stand-ins reach the API there.
const API = (process.env.OPENRENT_API_URL ?? 'http://localhost:7170').replace('//localhost:', '//127.0.0.1:');
const WIDGET_DEV = process.env.WIDGET_URL ?? 'http://localhost:7173';

/**
 * The WordPress plugin against this OpenRent (FR-SF-7), in WordPress Playground: the admin connects the site
 * with OpenRent sign-in, puts a category on a page, and a visitor sees the shop's products there.
 */
test('a WordPress site connects with OpenRent sign-in and shows the shop’s products on a page', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  const port = 29900 + Math.floor(Math.random() * 500);
  const site = `http://127.0.0.1:${port}`;
  const wp: any = await runCLI({
    command: 'server',
    php: '8.3',
    wp: 'latest',
    quiet: true,
    port,
    'site-url': site,
    mount: [{ hostPath: fileURLToPath(new URL('../integrations/wordpress/openrent', import.meta.url)), vfsPath: '/wordpress/wp-content/plugins/openrent' }],
    blueprint: { steps: [{ step: 'activatePlugin', pluginPath: 'openrent/openrent.php' }] },
  } as any);
  try {
    // The built widget comes from OpenRent in production; here the widget's dev server stands in.
    await page.route('**/widget/openrent-widget.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: `import(${JSON.stringify(`${WIDGET_DEV}/src/main.ts`)});` }));
    await signIn(page);

    await page.goto(`${site}/wp-login.php`);
    await page.getByLabel('Username or Email Address').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('password');
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.waitForURL(/wp-admin/);

    await page.goto(`${site}/wp-admin/options-general.php?page=openrent`);
    await page.getByLabel('OpenRent address').first().fill(API);
    await page.getByRole('button', { name: 'Connect to OpenRent' }).click();
    // OpenRent's consent page, signed in as the owner.
    await expect(page).toHaveURL(new RegExp(`^${ADMIN.replace(/[.]/g, '\\.')}/oauth/authorize`));
    await expect(page.getByTestId('oauth-consent')).toContainText('(WordPress)');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.waitForURL((u) => u.origin === site && u.pathname.endsWith('/options-general.php'));
    await expect(page.locator('#openrent-status')).toContainText('Connected to Tallinn Gear Rental');
    await shot(page, 'wordpress-connected');

    // The site added itself to the shop's widget sites, so payments come back to it.
    const settings = await (await page.request.get(`${new URL(ADMIN).origin}/api/v1/tenant/settings`)).json();
    expect(settings.widget_origins).toContain(site);

    const made = await wp.playground.run({
      code: `<?php require '/wordpress/wp-load.php'; $id = wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Rent with us', 'post_content' => '<!-- wp:openrent/category {"limit":3} /-->')); echo get_permalink($id);`,
    });
    await page.goto(made.text.trim());
    const category = page.locator('openrent-category');
    await expect(category).toHaveAttribute('shop', 'demo');
    // The shop's products, from OpenRent, on the WordPress page.
    await expect(category.locator('[part="title"]').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, 'wordpress-page');

    // Disconnecting from WordPress ends the app's access in OpenRent too.
    const clientId = (await wp.playground.run({ code: `<?php require '/wordpress/wp-load.php'; echo get_option('openrent_settings')['client_id'];` })).text.trim();
    const grants = async () => (await (await page.request.get(`${new URL(ADMIN).origin}/api/v1/oauth_grants`)).json()).data.filter((g: any) => g.client_id === clientId);
    expect(await grants()).toHaveLength(1);
    await page.goto(`${site}/wp-admin/options-general.php?page=openrent`);
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.locator('.notice-success')).toContainText('Disconnected from OpenRent');
    expect(await grants()).toEqual([]);
  } finally {
    // Off WordPress first: its admin keeps calling home, and those calls fail once it stops.
    await page.goto('about:blank');
    await wp[Symbol.asyncDispose]();
  }
  expect(errors).toEqual([]);
});
