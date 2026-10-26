<script lang="ts">
  import { getRuntime, type CollectionData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import PackageIcon from '@lucide/svelte/icons/package';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { h1 } from '../lib/ink.ts';

  let { data }: { data: CollectionData } = $props();
  const rt = getRuntime();
</script>

<h1 class={[h1, 'mb-8']}>{data.category.name}</h1>
{#if data.products.length}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each data.products as p (p.id)}<ProductCard product={p} />{/each}
  </div>
{:else}
  <Empty.Root class="rounded-2xl border border-(--border)">
    <Empty.Header>
      <Empty.Media variant="icon"><PackageIcon /></Empty.Media>
      <Empty.Title>{rt.t('collection.empty')}</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{/if}
