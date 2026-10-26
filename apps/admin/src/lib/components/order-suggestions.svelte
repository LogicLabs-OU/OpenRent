<script lang="ts">
  import { Button } from '@openrent/ui/button';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { api, t } from '#lib';

  /**
   * Accessories and products often rented with what is already on the order (FR-CAT-7), one click to
   * add; those already on it are left out.
   */
  let { productIds, onadd }: { productIds: string[]; onadd: (v: { id: string; label: string; type: string; product_id: string }) => void } = $props();
  let items = $state<{ id: string; name: string; variant_id: string; type: string }[]>([]);

  $effect(() => {
    const ids = [...new Set(productIds)];
    if (!ids.length) {
      items = [];
      return;
    }
    Promise.all(ids.map((id) => api.get(`/products/${id}/relations`).catch(() => null))).then((all) => {
      const out = new Map<string, { id: string; name: string; variant_id: string; type: string }>();
      for (const r of all) {
        for (const x of [...(r?.accessory ?? []), ...(r?.often_rented_with ?? [])]) {
          if (x.variant_id && !ids.includes(x.id) && !out.has(x.id)) out.set(x.id, { id: x.id, name: x.name, variant_id: x.variant_id, type: x.type });
        }
      }
      items = [...out.values()].slice(0, 6);
    });
  });
</script>

{#if items.length}
  <div class="flex flex-wrap items-center gap-2 text-sm" data-testid="order-suggestions">
    <span class="text-muted-foreground">{t('relations.suggest')}</span>
    {#each items as x (x.id)}
      <Button size="sm" variant="outline" onclick={() => onadd({ id: x.variant_id, label: x.name, type: x.type, product_id: x.id })}><PlusIcon />{x.name}</Button>
    {/each}
  </div>
{/if}
