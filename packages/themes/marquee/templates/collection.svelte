<script lang="ts">
  import { getRuntime, type CollectionData } from '@openrent/theme-sdk';
  import ProductCard from '../snippets/ProductCard.svelte';
  import Chips from '../snippets/Chips.svelte';
  import { h1, pad } from '../lib/marquee.ts';
  import { reveal } from '../lib/motion.ts';

  /** A category as one page of the programme: the name huge with its count, the sticky chips, the posters. */
  let { data }: { data: CollectionData } = $props();
  const rt = getRuntime();
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-end justify-between gap-6 border-b border-(--mq-ink) pb-5">
    <h1 class={[h1, 'min-w-0 break-words']}>{data.category.name}</h1>
    <span class="mq-mono shrink-0 pb-1 text-[clamp(1.5rem,3vw,2.5rem)] leading-none">{pad(data.products.length)}</span>
  </div>
  <Chips active={data.category.id} counts={{ [data.category.id]: data.products.length }} />
  {#if data.products.length}
    <div class="grid grid-cols-1 gap-6 pt-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {#each data.products as p, i (p.id)}<div class="min-w-0" use:reveal={(i % 4) * 80}>
          <ProductCard product={p} />
        </div>{/each}
    </div>
  {:else}
    <div class="flex flex-col items-start gap-6 border border-(--mq-ink) p-8 md:p-12">
      <p class="mq-tight text-[clamp(2.25rem,5vw,4rem)] leading-[0.9] font-bold uppercase">
        {rt.t('collection.empty')}
      </p>
      <a class="mq-fill flex h-12 items-center border border-(--mq-ink) px-5 text-lg font-bold uppercase" href={rt.url.home()}
        >{rt.t('nav.all')}</a
      >
    </div>
  {/if}
</div>
