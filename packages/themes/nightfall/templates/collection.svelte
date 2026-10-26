<script lang="ts">
  import { getRuntime, type CollectionData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import ProductCard from '../snippets/ProductCard.svelte';
  import PageHead from '../snippets/PageHead.svelte';
  import { categoryIcon } from '../lib/icons.ts';
  import { glass } from '../lib/nightfall.ts';
  import { reveal } from '../lib/motion.ts';

  let { data }: { data: CollectionData } = $props();
  const rt = getRuntime();
  const Icon = $derived(categoryIcon(data.category.name, data.category.slug));
</script>

<PageHead title={data.category.name} eyebrow={rt.t('nav.categories')}>
  <p class="text-white/60">{rt.t('search.count', { count: data.products.length })}</p>
</PageHead>
{#if data.products.length}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3 xl:grid-cols-4">
    {#each data.products as p, i (p.id)}<div use:reveal={(i % 4) * 80}><ProductCard product={p} /></div>{/each}
  </div>
{:else}
  <Empty.Root class={[glass, 'nf-dots py-16']}>
    <Empty.Header>
      <Empty.Media variant="icon" class="size-14 rounded-2xl bg-white/10 text-white"><Icon class="size-7" /></Empty.Media>
      <Empty.Title class="text-xl font-semibold">{rt.t('collection.empty')}</Empty.Title>
    </Empty.Header>
    <Empty.Content><Button class="h-11 rounded-full px-6" href={rt.url.home()}>{rt.t('nav.all')}</Button></Empty.Content>
  </Empty.Root>
{/if}
