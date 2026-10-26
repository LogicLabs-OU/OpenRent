<script lang="ts">
  import { onMount } from 'svelte';
  import * as Alert from '@openrent/ui/alert';
  import { Button } from '@openrent/ui/button';
  import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
  import { api, rel, t } from '#lib';
  import { to } from '#lib/nav.ts';

  /** Customers' pending requests to keep a booking longer, linked to their orders (Today and Orders pages). */
  let pending = $state<any[]>([]);
  onMount(() => {
    api.get('/extension_requests?status=pending').then(
      (r) => (pending = r.data),
      () => undefined,
    );
  });
</script>

{#if pending.length}
  <Alert.Root class="mb-6 border-amber-500/40 bg-amber-50 dark:bg-amber-950" data-testid="pending-extensions">
    <CalendarClockIcon />
    <Alert.Title>{t('extension.pending', { count: pending.length })}</Alert.Title>
    <Alert.Description>
      <ul class="flex flex-col gap-1">
        {#each pending.slice(0, 5) as r (r.id)}
          <li class="flex flex-wrap items-center gap-x-2">
            <Button variant="link" class="h-auto p-0" href={to(`/orders/${r.order_id}`)}>#{r.order_number}</Button>
            <span>{r.customer_name ?? ''} · {rel(r.created_at)}</span>
          </li>
        {/each}
      </ul>
    </Alert.Description>
  </Alert.Root>
{/if}
