<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { title, wrap } from '../lib/retro.ts';

  let {
    heading,
    category,
    limit,
    products,
    anchor,
  }: { heading: string; category: string; limit: number; products: Product[]; anchor: boolean } = $props();
  const rt = getRuntime();
  const categoryId = $derived(
    category ? rt.shop.categories.find((c) => c.slug === category || c.id === category)?.id : undefined,
  );
  const shown = $derived(
    (categoryId ? products.filter((p) => p.category_ids.includes(categoryId)) : products).slice(
      0,
      limit || 100,
    ),
  );
</script>

<!-- The first product section is #catalog, where "Rent now" and the closing button lead. -->
<section id={anchor ? 'catalog' : undefined} class={[wrap, 'flex scroll-mt-24 flex-col gap-6 py-12']}>
  <h2 class={title}>{heading || rt.t('nav.all')}</h2>
  {#if !rt.shop.dates.from}
    <p
      class="flex items-center gap-3 rounded-[0.25rem] border border-black bg-(--retro-highlight) px-4 py-3 text-(--retro-highlight-ink)"
      role="note"
    >
      <CalendarDaysIcon class="size-5 shrink-0" />{rt.t('dates.hint')}
    </p>
  {/if}
  <div class="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
    {#each shown as p (p.id)}<ProductCard product={p} />{/each}
  </div>
</section>
