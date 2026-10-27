import { expect } from '@playwright/test';
import { test, ADMIN, collectErrors, shot, signIn } from './helpers.ts';

test('staff subscribe to pickups and returns with a calendar feed and revoke it', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=calendar`);
  const card = page.getByTestId('calendar-feeds');
  await card.getByRole('button', { name: 'New calendar feed' }).click();
  const dialog = page.getByRole('dialog');
  const feedName = `Counter tablet ${Date.now()}`;
  await dialog.getByLabel('Name').fill(feedName);
  await dialog.getByRole('button', { name: 'Create' }).click();
  const url = await dialog.getByTestId('calendar-url').inputValue();
  expect(url).toMatch(/\/api\/v1\/calendar\/[\w-]+\.ics$/);
  await shot(page, 'admin-calendar-feed');

  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  expect(await res.text()).toMatch(/^BEGIN:VCALENDAR\r\n/);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await card.getByRole('row').filter({ hasText: feedName }).getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Feed revoked' }).last()).toBeVisible();
  expect((await page.request.get(url)).status()).toBe(404);
  expect(errors).toEqual([]);
});
