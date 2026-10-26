<script lang="ts">
  import { getRuntime, type CollectionData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import PackageIcon from '@lucide/svelte/icons/package';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { display, solid, wrap } from '../lib/retro.ts';

  let { data }: { data: CollectionData } = $props();
  const rt = getRuntime();
</script>

<div class={[wrap, 'flex flex-col gap-10 py-12 md:py-16']}>
  <h1 class={display}>{data.category.name}</h1>
  {#if data.products.length}
    <div class="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
      {#each data.products as p (p.id)}<ProductCard product={p} />{/each}
    </div>
  {:else}
    <Empty.Root class="rounded-[0.25rem] border border-solid border-black bg-white">
      <Empty.Header>
        <Empty.Media variant="icon" class="border border-black bg-(--retro-accent) text-(--retro-accent-ink)"
          ><PackageIcon /></Empty.Media
        >
        <Empty.Title class="text-xl font-normal">{rt.t('collection.empty')}</Empty.Title>
      </Empty.Header>
      <Empty.Content><Button href={rt.url.home()} class={solid}>{rt.t('nav.all')}</Button></Empty.Content>
    </Empty.Root>
  {/if}
</div>
