import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { request, type APIRequestContext } from '@playwright/test';
import { ADMIN, ADMIN_STATE } from './helpers.ts';

/**
 * Signs the staff owner in once per run and saves the session cookies. Specs reuse it, so a run
 * stays under the login rate limit (10 per minute per address) however many specs need the admin.
 *
 * With `E2E_CLEANUP=1` (a reused test database only, never a real shop) it first cancels the open
 * orders earlier runs left behind, so their bookings cannot use up the stock later runs book, and deletes
 * the throwaway products specs create, so lists and pickers keep the demo products in view.
 */
export default async function globalSetup() {
  const api = await request.newContext({ baseURL: new URL(ADMIN).origin });
  const res = await api.post('/api/v1/auth/login', {
    data: {
      email: process.env.E2E_EMAIL ?? 'owner@example.com',
      password: process.env.E2E_PASSWORD ?? 'openrent',
    },
  });
  if (!res.ok()) throw new Error(`Staff sign-in for the e2e run failed: ${res.status()} ${await res.text()}`);
  if (process.env.E2E_CLEANUP === '1') {
    await cancelOldOrders(api);
    await cancelOldTickets(api);
    await deleteTestProducts(api);
  }
  mkdirSync(path.dirname(ADMIN_STATE), { recursive: true });
  await api.storageState({ path: ADMIN_STATE });
  await api.dispose();
}

/** Cancels every order still draft, quote, reserved or prepared that was created before this run. */
async function cancelOldOrders(api: APIRequestContext) {
  const before = new Date().toISOString();
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'or_csrf')?.value ?? '';
  const query = `/api/v1/orders?limit=200&filter[status]=draft,quote,reserved,prepared&filter[created_at][lt]=${encodeURIComponent(before)}`;
  let cancelled = 0;
  for (;;) {
    const page = await api.get(query);
    if (!page.ok()) throw new Error(`Listing old orders failed: ${page.status()} ${await page.text()}`);
    const ids = ((await page.json()) as { data: { id: string }[] }).data.map((o) => o.id);
    if (!ids.length) break;
    // A few at a time: fast enough for thousands of orders, light enough for the dev server.
    for (let i = 0; i < ids.length; i += 8) {
      const results = await Promise.all(ids.slice(i, i + 8).map((id) => api.post(`/api/v1/orders/${id}/actions/cancel`, { data: {}, headers: { 'x-csrf-token': csrf } })));
      const failed = results.find((r) => !r.ok());
      if (failed) throw new Error(`Cancelling an old order failed: ${failed.status()} ${await failed.text()}`);
      cancelled += results.length;
    }
  }
  if (cancelled) process.stdout.write(`e2e cleanup: cancelled ${cancelled} orders left by earlier runs\n`);
}

/** Cancels repair tickets earlier runs left open, so a spec finds its own ticket on the first page. */
async function cancelOldTickets(api: APIRequestContext) {
  const before = Date.now();
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'or_csrf')?.value ?? '';
  const res = await api.get('/api/v1/maintenance_tickets?status=active');
  if (!res.ok()) throw new Error(`Listing repair tickets failed: ${res.status()} ${await res.text()}`);
  const old = ((await res.json()) as { data: { id: string; created_at: string }[] }).data.filter((t) => Date.parse(t.created_at) < before);
  for (let i = 0; i < old.length; i += 8) {
    await Promise.all(old.slice(i, i + 8).map((t) => api.post(`/api/v1/maintenance_tickets/${t.id}/actions/cancel`, { data: { reason: 'e2e cleanup' }, headers: { 'x-csrf-token': csrf } })));
  }
  if (old.length) process.stdout.write(`e2e cleanup: cancelled ${old.length} repair tickets left by earlier runs\n`);
}

/**
 * Specs name the products they create with a number at the end (`Swap bike 1792…`, `Generator 4711`) or
 * an `E2E ` prefix (no demo product's name ends in a number); earlier runs' ones are deleted. One that has
 * orders cannot be deleted, so it is archived, which keeps it out of lists and pickers.
 */
async function deleteTestProducts(api: APIRequestContext) {
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'or_csrf')?.value ?? '';
  const made: { id: string; visibility: string }[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.get(`/api/v1/products?limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    if (!res.ok()) throw new Error(`Listing products failed: ${res.status()} ${await res.text()}`);
    const page = (await res.json()) as { data: { id: string; name: string; visibility: string }[]; has_more: boolean; next_cursor: string | null };
    made.push(...page.data.filter((p) => / \d+$/.test(p.name) || /^E2E /.test(p.name)));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  let deleted = 0;
  let archived = 0;
  for (let i = 0; i < made.length; i += 8) {
    await Promise.all(
      made.slice(i, i + 8).map(async (p) => {
        if ((await api.delete(`/api/v1/products/${p.id}`, { headers: { 'x-csrf-token': csrf } })).ok()) deleted++;
        else if (p.visibility !== 'archived' && (await api.post(`/api/v1/products/${p.id}/actions/archive`, { data: {}, headers: { 'x-csrf-token': csrf } })).ok()) archived++;
      }),
    );
  }
  if (deleted || archived) process.stdout.write(`e2e cleanup: deleted ${deleted} and archived ${archived} products earlier runs made\n`);
}
