<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import ProductCard from '../snippets/ProductCard.svelte';
  import Chips from '../snippets/Chips.svelte';
  import { h2 } from '../lib/marquee.ts';
  import { reveal } from '../lib/motion.ts';

  /** The poster wall: a big heading with the count in mono, the sticky category chips, then the cards. */
  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as { heading: string; text: string; category: string; limit: number; chips: boolean },
  );
  const categoryId = $derived(
    s.category ? rt.shop.categories.find((c) => c.slug === s.category || c.id === s.category)?.id : undefined,
  );
  const shown = $derived(
    (categoryId ? products.filter((p) => p.category_ids.includes(categoryId)) : products).slice(
      0,
      s.limit || 100,
    ),
  );
  const counts = $derived(
    Object.fromEntries(
      rt.shop.categories.map((c) => [c.id, products.filter((p) => p.category_ids.includes(c.id)).length]),
    ),
  );
</script>

<section class="mb-16 flex flex-col gap-4 md:mb-24" data-section="product-grid">
  {#if s.heading || s.text}
    <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-10">
      <div class="flex max-w-3xl flex-col gap-4">
        {#if s.heading}<h2 class={h2}>{s.heading}</h2>{/if}
        {#if s.text}<p class="text-lg leading-snug font-semibold text-pretty uppercase">{s.text}</p>{/if}
      </div>
      <p class="mq-mono shrink-0 text-sm uppercase">{rt.t('grid.count', { count: shown.length })}</p>
    </div>
  {/if}
  {#if s.chips !== false && rt.shop.categories.length}<Chips
      active={categoryId ?? 'all'}
      {counts}
      total={products.length}
    />{/if}
  <div class="grid grid-cols-1 gap-6 pt-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each shown as p, i (p.id)}<div class="min-w-0" use:reveal={(i % 4) * 80}><ProductCard product={p} /></div>{/each}
  </div>
</section>
