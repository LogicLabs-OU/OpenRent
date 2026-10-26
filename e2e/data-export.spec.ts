import { expect, test } from '@playwright/test';
import { ADMIN, collectErrors, shot, signIn } from './helpers.ts';

// The ZIP itself is built by the worker and checked in apps/api/test/jobs-export.test.ts; the e2e stack runs no worker.
test('the owner starts a full data export and sees it waiting for the worker', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto(`${ADMIN}/settings?tab=general`);
  const card = page.getByTestId('data-export');
  const start = card.getByRole('button', { name: 'Start export' });
  // Wait for the list: a running export from an earlier run keeps the button disabled.
  await expect(card).toHaveAttribute('data-loaded', 'true');
  // An export from an earlier run may still wait for a worker (the e2e stack has none).
  if (await start.isEnabled()) await start.click();
  await expect(card.getByText(/Waiting for the worker|Exporting/)).toBeVisible();
  await expect(start).toBeDisabled();
  await expect(card.getByTestId('data-export-row').first()).toContainText(/Waiting|Running/);
  await shot(page, 'admin-data-export');
  expect(errors).toEqual([]);
});
