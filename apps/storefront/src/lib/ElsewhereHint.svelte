<script lang="ts">
  import { page } from '$app/state';
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { t } from './i18n/index.ts';

  /** When nothing is free at the visitor's location for their dates: the other locations that have it, with a switch. */
  let { product }: { product: Product } = $props();
  const rt = getRuntime();
  const locale = $derived(page.data.shop?.locale);
  const others = $derived.by(() => {
    if (product.variants.some((v) => (v.available ?? 1) > 0)) return [];
    const seen = new Map<string, { location_id: string; name: string }>();
    for (const v of product.variants) for (const e of v.elsewhere ?? []) seen.set(e.location_id, e);
    return [...seen.values()];
  });
</script>

{#if others.length && rt.setLocation}
  <div class="flex flex-col gap-2 rounded-lg border p-3 text-sm" role="status" data-testid="available-elsewhere">
    {#each others as o (o.location_id)}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>{t('location.free_at', { name: o.name }, locale)}</span>
        <Button size="sm" variant="outline" onclick={() => rt.setLocation!(o.location_id)}>{t('location.switch', { name: o.name }, locale)}</Button>
      </div>
    {/each}
  </div>
{/if}
