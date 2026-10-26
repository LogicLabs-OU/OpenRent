import { expect, test } from '@playwright/test';
import { ADMIN, STORE, collectErrors, hydrated, shot, signIn } from './helpers.ts';

test('staff manage plugins, email and the storefront theme', async ({ page, context }) => {
  const errors = collectErrors(page);
  await signIn(page);

  // Plugins: the first-party plugins are listed with their state.
  await page.getByRole('link', { name: 'Plugins' }).first().click();
  // The built-in plugins plus the e2e fixture plugin (e2e/fixtures/plugins.json).
  await expect(page.getByTestId('plugin-card')).toHaveCount(13);
  await expect(page.getByTestId('plugin-card').filter({ hasText: 'SMTP email' })).toBeVisible();
  await expect(page.getByTestId('plugin-card').filter({ hasText: 'S3 file storage' })).toBeVisible();
  await shot(page, 'admin-plugins');

  // Email: point the shop at a local SMTP server and send a test.
  const smtpPort = process.env.E2E_SMTP_PORT;
  await page.goto(`${ADMIN}/settings`);
  await page.getByRole('tab', { name: 'Email' }).click();
  const email = page.getByRole('tabpanel', { name: 'Email' });
  if (smtpPort) {
    await email.getByLabel('SMTP server').fill('127.0.0.1');
    await email.getByLabel('Port').fill(smtpPort);
    await email.getByLabel('Security').selectOption('none');
    await email.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();
    await email.getByRole('button', { name: 'Send test' }).first().click();
    await expect(email.getByRole('status').filter({ hasText: /Test email sent to/ })).toBeVisible();
  }
  await email
    .getByRole('row', { name: /Booking confirmed/ })
    .getByRole('button', { name: 'Edit' })
    .click();
  await expect(page.locator('iframe[title="Preview"]')).toBeVisible();
  await shot(page, 'admin-email-template');
  await page.keyboard.press('Escape');

  // Themes: customise the hero heading and a storefront text, then preview.
  const heading = `Rent smarter ${Date.now() % 10000}`;
  await page.getByRole('link', { name: 'Themes' }).first().click();
  // The bundled themes; child themes uploaded by other specs may also be listed.
  await expect(page.getByTestId('theme-card').filter({ hasText: /OpenRent Default|Retro|Concept|Ink Green|Marquee|Linen|Nightfall/ })).toHaveCount(7);
  await shot(page, 'admin-themes');
  await page
    .getByTestId('theme-card')
    .filter({ hasText: 'OpenRent Default' })
    .getByRole('link', { name: 'Customise' })
    .click();
  await shot(page, 'admin-theme-settings');

  // Home page sections: change the hero heading, add an FAQ above it and see it in the preview frame.
  await page.getByRole('tab', { name: 'Home page' }).click();
  const sections = page.getByRole('tabpanel', { name: 'Home page' });
  await sections
    .getByTestId('section-list')
    .getByRole('button', { name: /^Rent the gear/ })
    .click();
  await sections.getByTestId('section-editor').getByLabel('Heading').fill(heading);
  await sections.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('menuitem', { name: 'Questions and answers' }).click();
  for (let i = 0; i < 3; i++) await sections.getByRole('button', { name: 'Move Questions up' }).click();
  await sections.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Home page saved' }).last(),
  ).toBeVisible();
  const frame = page.frameLocator('[data-testid="section-preview"]');
  await expect(frame.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  const order = await frame
    .locator('[data-section-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-section-id')?.split('-')[0]));
  expect(order.slice(0, 2)).toEqual(['faq', 'hero']);
  await shot(page, 'admin-theme-sections');
  await page.getByRole('tab', { name: 'Texts' }).click();
  // A text no other test reads, so a run that stops halfway leaves the storefront test's labels alone.
  await page.getByLabel('product.book', { exact: true }).fill('Reserve this item');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();

  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Preview' }).click();
  const sf = await popup;
  await sf.waitForURL(`${STORE}/**`);
  await expect(
    sf.getByRole('status').filter({ hasText: /Previewing the OpenRent Default theme/ }),
  ).toBeVisible();
  await expect(sf.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await shot(sf, 'sf-theme-preview');
  await sf.getByRole('link', { name: 'Exit preview' }).click();
  await expect(sf.getByRole('status').filter({ hasText: /Previewing/ })).toHaveCount(0);
  await hydrated(sf);
  await expect(sf.getByRole('heading', { level: 1, name: heading })).toBeVisible();

  // Restore the theme text.
  await page.getByLabel('product.book', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved' }).last()).toBeVisible();
  await page.getByRole('tab', { name: 'Home page' }).click();
  await page
    .getByRole('tabpanel', { name: 'Home page' })
    .getByRole('button', { name: 'Use theme default' })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Use theme default' }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Home page reset' }).last(),
  ).toBeVisible();

  // The Retro theme previews without going live, so other tests keep the default theme.
  await page.getByRole('link', { name: 'Themes' }).first().click();
  const retroTab = context.waitForEvent('page');
  await page
    .getByTestId('theme-card')
    .filter({ hasText: 'Retro' })
    .getByRole('button', { name: 'Preview' })
    .click();
  const retro = await retroTab;
  await retro.waitForURL(`${STORE}/**`);
  await expect(retro.getByRole('status').filter({ hasText: /Previewing the Retro theme/ })).toBeVisible();
  await expect(retro.getByRole('heading', { level: 2, name: 'How renting works' })).toBeVisible();
  await expect(retro.getByTestId('product-card').first()).toBeVisible();
  await shot(retro, 'sf-retro-preview');

  // Concept: the sidebar lists the shop's pages and products switch between gallery and table views.
  const conceptTab = context.waitForEvent('page');
  await page
    .getByTestId('theme-card')
    .filter({ hasText: 'Concept' })
    .getByRole('button', { name: 'Preview' })
    .click();
  const concept = await conceptTab;
  await concept.waitForURL(`${STORE}/**`);
  await expect(concept.getByRole('status').filter({ hasText: /Previewing the Concept theme/ })).toBeVisible();
  await expect(concept.getByRole('link', { name: 'Home' }).first()).toBeVisible();
  await expect(concept.getByTestId('product-card').first()).toBeVisible();
  await hydrated(concept);
  await concept.getByRole('tab', { name: 'Table' }).click();
  await expect(concept.getByTestId('product-table')).toBeVisible();
  await shot(concept, 'sf-concept-preview');

  // Ink Green: the home hero carries the date search; the closing band follows the products.
  const inkTab = context.waitForEvent('page');
  await page
    .getByTestId('theme-card')
    .filter({ hasText: 'Ink Green' })
    .getByRole('button', { name: 'Preview' })
    .click();
  const ink = await inkTab;
  await ink.waitForURL(`${STORE}/**`);
  await expect(ink.getByRole('status').filter({ hasText: /Previewing the Ink Green theme/ })).toBeVisible();
  await expect(ink.getByRole('heading', { level: 1 })).toContainText('Rent the gear');
  await expect(ink.getByTestId('date-bar')).toBeVisible();
  await expect(ink.getByTestId('product-card').first()).toBeVisible();
  await expect(ink.locator('[data-section="cta"]')).toBeVisible();
  await shot(ink, 'sf-ink-green-preview');

  // Marquee, Linen and Nightfall: each previews with its own hero, the date search and product cards.
  for (const [name, h1] of [['Marquee', /gear line-up/i], ['Linen', /Get out there/], ['Nightfall', /Your gear, at your/]] as const) {
    const tab = context.waitForEvent('page');
    await page.getByTestId('theme-card').filter({ hasText: name }).getByRole('button', { name: 'Preview' }).click();
    const sf = await tab;
    await sf.waitForURL(`${STORE}/**`);
    await expect(sf.getByRole('status').filter({ hasText: new RegExp(`Previewing the ${name} theme`) })).toBeVisible();
    await expect(sf.getByRole('heading', { level: 1 })).toContainText(h1);
    await expect(sf.getByTestId('date-bar')).toBeVisible();
    await expect(sf.getByTestId('product-card').first()).toBeVisible();
    await hydrated(sf);
    await shot(sf, `sf-${name.toLowerCase()}-preview`);
    await sf.close();
  }
  expect(errors).toEqual([]);
});
