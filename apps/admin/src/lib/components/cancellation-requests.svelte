<script lang="ts">
  import { onMount } from 'svelte';
  import * as Alert from '@openrent/ui/alert';
  import { Button } from '@openrent/ui/button';
  import MessageSquareWarningIcon from '@lucide/svelte/icons/message-square-warning';
  import { api, rel, t } from '#lib';
  import { to } from '#lib/nav.ts';

  /** Customers' pending cancellation requests, linked to their orders (Today and Orders pages). */
  let pending = $state<any[]>([]);
  onMount(() => {
    api.get('/cancellation_requests?status=pending').then(
      (r) => (pending = r.data),
      () => undefined,
    );
  });
</script>

{#if pending.length}
  <Alert.Root
    class="mb-6 border-amber-500/40 bg-amber-50 dark:bg-amber-950"
    data-testid="pending-cancellations"
  >
    <MessageSquareWarningIcon />
    <Alert.Title>{t('cancellation.pending', { count: pending.length })}</Alert.Title>
    <Alert.Description>
      <ul class="flex flex-col gap-1">
        {#each pending.slice(0, 5) as r (r.id)}
          <li class="flex flex-wrap items-center gap-x-2">
            <Button variant="link" class="h-auto p-0" href={to(`/orders/${r.order_id}`)}
              >#{r.order_number}</Button
            >
            <span>{r.customer_name ?? ''} · {rel(r.created_at)}</span>
          </li>
        {/each}
      </ul>
    </Alert.Description>
  </Alert.Root>
{/if}
