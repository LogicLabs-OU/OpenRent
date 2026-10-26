<script lang="ts">
  import { getRuntime, type CollectionData } from '@openrent/theme-sdk';
  import PageHeader from '../snippets/PageHeader.svelte';
  import Callout from '../snippets/Callout.svelte';
  import Database from '../snippets/Database.svelte';
  import { categoryIcons, col } from '../lib/concept.ts';

  let { data }: { data: CollectionData } = $props();
  const rt = getRuntime();
  const icon = $derived(categoryIcons(rt.shop.settings.category_icons)[data.category.slug] ?? '');
</script>

<PageHeader title={data.category.name} {icon} />
<div class={[col, 'flex flex-col gap-4']}>
  {#if data.products.length}
    {#if !rt.shop.dates.from}<Callout icon="📅">{rt.t('dates.hint')}</Callout>{/if}
    <Database products={data.products} />
  {:else}
    <Callout icon="🗂️">{rt.t('collection.empty')}</Callout>
  {/if}
</div>
