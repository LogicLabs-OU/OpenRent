<script lang="ts">
  import { getRuntime, type CollectionData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import PackageIcon from '@lucide/svelte/icons/package';
  import Headline from '../snippets/Headline.svelte';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { h1 } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

  let { data }: { data: CollectionData } = $props();
  const rt = getRuntime();
</script>

<div class="mb-10 flex flex-col gap-4 md:mb-14">
  <p class="flex items-center gap-2.5 text-[0.8125rem] font-medium text-[var(--ln-accent)]">
    <span class="ln-square size-2" aria-hidden="true"></span>{rt.t('collection.label')}
  </p>
  <div class="flex flex-wrap items-end justify-between gap-4">
    <Headline tag="h1" text={data.category.name} mark={false} class={[h1, 'md:text-[4rem]']} />
    <p class="ln-mono text-sm text-[#666]">{rt.t('hero.items', { count: data.products.length })}</p>
  </div>
</div>
{#if data.products.length}
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each data.products as p, i (p.id)}<div class="flex flex-col *:flex-1" use:reveal style:--ln-delay={`${(i % 4) * 0.07}s`}>
        <ProductCard product={p} index={i} />
      </div>{/each}
  </div>
{:else}
  <Empty.Root class="rounded-[20px] bg-[var(--ln-panel)]">
    <Empty.Header>
      <Empty.Media variant="icon" class="bg-white"><PackageIcon /></Empty.Media>
      <Empty.Title class="ln-display text-2xl">{rt.t('collection.empty')}</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{/if}
