<script lang="ts">
  import * as Popover from '@openrent/ui/popover';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import MapPinIcon from '@lucide/svelte/icons/map-pin';
  import { api, qs, t, notifyError, session } from '#lib';
  import { to } from '#lib/nav.ts';

  /**
   * How many of a variant the other locations have free over the rental, with a shortcut to plan a
   * transfer here that arrives by the pickup (FR-LOC-2). Hidden for single-location shops.
   */
  let { variantId, name, locationId, from, until, needed }: { variantId: string; name: string; locationId: string; from: string; until: string; needed: number } = $props();
  let open = $state(false);
  let rows = $state<any[] | null>(null);

  $effect(() => {
    if (!open) return;
    rows = null;
    api.get(`/availability?${qs({ variant_id: variantId, location_id: '*', from, to: until })}`).then((r) => (rows = r.data.filter((x: any) => x.location_id !== locationId)), notifyError);
  });

  /** The transfers page opens a new transfer with these filled in. */
  const transferLink = (r: any) =>
    to(`/inventory/transfers?${qs({ new: 1, from: r.location_id, to: locationId, eta: from, variant_id: r.tracking === 'bulk' ? variantId : undefined, name: r.tracking === 'bulk' ? name : undefined, quantity: r.tracking === 'bulk' ? Math.min(needed, r.available) : undefined })}`);
</script>

{#if !session.singleLocation}
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="link" size="sm" class="h-auto p-0 text-xs">{t('availability.elsewhere')}</Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="start" class="w-72" data-testid="availability-elsewhere">
      <p class="mb-2 text-sm font-medium">{t('availability.elsewhere_title', { name })}</p>
      {#if !rows}
        <div class="text-muted-foreground flex items-center gap-2 text-sm"><Spinner />{t('common.loading')}</div>
      {:else}
        <ul class="flex flex-col gap-2 text-sm">
          {#each rows as r (r.location_id)}
            <li class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-1.5"><MapPinIcon class="text-muted-foreground size-3.5" aria-hidden="true" />{r.location_name}</span>
              <span class="flex items-center gap-2">
                <span class="tabular-nums">{r.available === null ? '∞' : t('availability.free', { count: r.available })}</span>
                {#if r.available > 0 && r.tracking !== 'none' && session.can('inventory:write')}
                  <Button size="sm" variant="outline" href={transferLink(r)}>{t('availability.transfer_here')}</Button>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}
