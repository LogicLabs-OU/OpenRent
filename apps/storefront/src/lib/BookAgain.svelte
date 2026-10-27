<script lang="ts">
  import { page } from '$app/state';
  import { getRuntime } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { t } from './i18n/index.ts';

  /** Past bookings to book again: their items go into a new cart, and the customer picks new dates. */
  const rt = getRuntime();
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0], params: Record<string, string | number> = {}) => t(key, params, locale);
  const past = $derived(((page.data.account?.orders ?? []) as { id: string; number: number; status: string; upcoming: boolean; starts_at: string }[]).filter((o) => !o.upcoming).slice(0, 5));
  let busy = $state<string | null>(null);
  let failed = $state('');
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  async function again(id: string) {
    busy = id;
    failed = '';
    try {
      const res = await fetch('/_or/account/book-again', { method: 'POST', headers: { 'content-type': 'application/json', ...(locale ? { 'x-or-locale': locale } : {}) }, body: JSON.stringify({ order_id: id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? res.statusText);
      const skipped = (body.skipped ?? []) as string[];
      window.location.href = `${rt.url.cart()}${skipped.length ? `?skipped=${encodeURIComponent(skipped.join(', '))}` : ''}`;
    } catch (err) {
      failed = (err as Error).message;
      busy = null;
    }
  }
</script>

{#if past.length}
  <Card.Root data-testid="account-book-again">
    <Card.Header><Card.Title>{tr('account.book_again.title')}</Card.Title><Card.Description>{tr('account.book_again.hint')}</Card.Description></Card.Header>
    <Card.Content class="flex flex-col gap-2">
      {#each past as o (o.id)}
        <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{tr('account.owed.booking', { number: o.number })} · {date(o.starts_at)}</span>
          <Button size="sm" variant="outline" disabled={!!busy} onclick={() => again(o.id)}>{#if busy === o.id}<Spinner />{/if}{tr('account.book_again.button')}</Button>
        </div>
      {/each}
      {#if failed}<p class="text-destructive text-sm" role="alert">{failed}</p>{/if}
    </Card.Content>
  </Card.Root>
{/if}
