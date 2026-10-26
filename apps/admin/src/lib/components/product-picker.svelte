<script module lang="ts">
  export interface PickedVariant {
    id: string;
    label: string;
    type: string;
    product_id?: string;
  }
</script>

<script lang="ts">
  import * as Command from '@openrent/ui/command';
  import { Spinner } from '@openrent/ui/spinner';
  import { api, t, notifyError } from '#lib';

  /**
   * Finds a product by typing and adds one of its variants (order editors). Products are searched on the
   * server, so it works for catalogues of any size; arrow keys and Enter pick without the mouse.
   */
  let { onpick, visibility }: { onpick: (v: PickedVariant) => void; visibility?: string } = $props();
  let query = $state('');
  let results = $state<PickedVariant[]>([]);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  $effect(() => {
    const q = query.trim();
    clearTimeout(timer);
    if (!q) {
      results = [];
      loading = false;
      return;
    }
    loading = true;
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const filter = visibility ? `&filter[visibility]=${visibility}` : '';
        const page = await api.get(`/products?q=${encodeURIComponent(q)}&limit=12${filter}`);
        if (mine !== seq) return;
        results = page.data.flatMap((p: any) =>
          p.variants.map((v: any) => ({
            id: v.id,
            label: v.name === p.name ? p.name : `${p.name} – ${v.name}`,
            type: p.type,
            product_id: p.id,
          })),
        );
      } catch (e) {
        notifyError(e);
      } finally {
        if (mine === seq) loading = false;
      }
    }, 150);
  });

  function pick(v: PickedVariant) {
    onpick(v);
    query = '';
    results = [];
  }
</script>

<div data-testid="product-picker">
  <Command.Root shouldFilter={false} label={t('new_order.add_product')} class="h-auto rounded-lg border">
    <Command.Input bind:value={query} placeholder={t('pricing.search_product')} />
    <!-- Always mounted: the input points at the list (aria-controls); it is hidden while it has no rows. -->
    <Command.List aria-label={t('pricing.search_results')} class={results.length ? '' : 'hidden'}>
      {#each results as v (v.id)}
        <Command.Item value={v.id} onSelect={() => pick(v)}>
          <span class="flex-1 truncate">{v.label}</span>
          {#if v.type === 'bundle'}<span class="text-xs text-muted-foreground"
              >{t('product.type.bundle')}</span
            >{/if}
        </Command.Item>
      {/each}
    </Command.List>
    {#if !results.length && query.trim()}
      <div role="status" class="flex justify-center p-3 text-sm text-muted-foreground">
        {#if loading}<Spinner />{:else}{t('search.empty')}{/if}
      </div>
    {/if}
  </Command.Root>
</div>
