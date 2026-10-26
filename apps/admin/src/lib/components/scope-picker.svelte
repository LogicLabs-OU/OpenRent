<script lang="ts">
  import { onMount } from 'svelte';
  import * as Field from '@openrent/ui/field';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Input } from '@openrent/ui/input';
  import XIcon from '@lucide/svelte/icons/x';
  import { api, t, notifyError } from '#lib';

  /**
   * Which products and categories a price rule, fee or coupon covers. Nothing chosen means every product.
   * Products are found by searching, so shops with any number of products can pick them.
   */
  let { productIds = $bindable([]), categoryIds = $bindable([]), idPrefix }: { productIds?: string[]; categoryIds?: string[]; idPrefix: string } = $props();
  let categories = $state<{ id: string; name: string }[]>([]);
  let names = $state<Record<string, string>>({});
  let query = $state('');
  let results = $state<{ id: string; name: string }[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    api.get('/categories?limit=200').then((c) => (categories = c.data.map((x: any) => ({ id: x.id, name: x.name }))), notifyError);
    // Names of the products already chosen.
    for (const id of productIds) api.get(`/products/${id}`).then((p) => (names = { ...names, [id]: p.name }), () => undefined);
  });

  function search() {
    clearTimeout(timer);
    const q = query.trim();
    if (!q) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      try {
        results = (await api.get(`/products?q=${encodeURIComponent(q)}&limit=8`)).data.map((p: any) => ({ id: p.id, name: p.name }));
      } catch (e) {
        notifyError(e);
      }
    }, 200);
  }

  function addProduct(p: { id: string; name: string }) {
    if (!productIds.includes(p.id)) productIds = [...productIds, p.id];
    names = { ...names, [p.id]: p.name };
    query = '';
    results = [];
  }
  function toggleCategory(id: string, on: boolean) {
    categoryIds = on ? [...categoryIds, id] : categoryIds.filter((x) => x !== id);
  }
</script>

<Field.Set>
  <Field.Legend variant="label">{t('pricing.scope')}</Field.Legend>
  <Field.Description>{productIds.length || categoryIds.length ? t('pricing.scope_some') : t('pricing.scope_all')}</Field.Description>
  {#if categories.length}
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {#each categories as c (c.id)}
        <Field.Field orientation="horizontal">
          <Checkbox id={`${idPrefix}-cat-${c.id}`} checked={categoryIds.includes(c.id)} onCheckedChange={(v) => toggleCategory(c.id, v === true)} />
          <Field.Label for={`${idPrefix}-cat-${c.id}`} class="font-normal">{c.name}</Field.Label>
        </Field.Field>
      {/each}
    </div>
  {/if}
  <Field.Field>
    <Field.Label for={`${idPrefix}-product`}>{t('pricing.add_product')}</Field.Label>
    <Input id={`${idPrefix}-product`} type="search" autocomplete="off" placeholder={t('pricing.search_product')} bind:value={query} oninput={search} />
    {#if results.length}
      <ul class="flex flex-col rounded-md border" aria-label={t('pricing.search_results')}>
        {#each results.filter((r) => !productIds.includes(r.id)) as r (r.id)}
          <li><button type="button" class="hover:bg-accent w-full px-3 py-1.5 text-left text-sm" onclick={() => addProduct(r)}>{r.name}</button></li>
        {/each}
      </ul>
    {/if}
    {#if productIds.length}
      <div class="flex flex-wrap gap-1.5">
        {#each productIds as id (id)}
          <Badge variant="secondary" class="gap-1 pr-1">
            {names[id] ?? id}
            <button type="button" class="hover:bg-muted rounded-sm" aria-label={t('pricing.remove_product', { name: names[id] ?? id })} onclick={() => (productIds = productIds.filter((x) => x !== id))}><XIcon class="size-3" /></button>
          </Badge>
        {/each}
      </div>
    {/if}
  </Field.Field>
</Field.Set>
