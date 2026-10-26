<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import Headline from '../snippets/Headline.svelte';
  import MoreLink from '../snippets/MoreLink.svelte';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { h2, lead } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as { heading: string; highlight: string; text: string; category: string; limit: number },
  );
  const categoryId = $derived(
    s.category ? rt.shop.categories.find((c) => c.slug === s.category || c.id === s.category)?.id : undefined,
  );
  const category = $derived(rt.shop.categories.find((c) => c.id === categoryId));
  const shown = $derived(
    (categoryId ? products.filter((p) => p.category_ids.includes(categoryId)) : products).slice(
      0,
      s.limit || 100,
    ),
  );
</script>

<section class="mb-20 flex flex-col gap-10 md:mb-28 md:gap-14" data-section="product-grid">
  <div class="flex flex-wrap items-end justify-between gap-6">
    <div class="flex max-w-3xl flex-col gap-5">
      {#if s.heading}<Headline text={s.heading} mark={s.highlight} class={h2} />{/if}
      {#if s.text}<p class={lead} use:reveal>{s.text}</p>{/if}
    </div>
    {#if category}<MoreLink href={rt.url.category(category.slug)} label={rt.t('products.all_in', { name: category.name })} />
    {:else if rt.url.search}<MoreLink href={rt.url.search()} label={rt.t('products.search')} />{/if}
  </div>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each shown as p, i (p.id)}<div class="flex flex-col *:flex-1" use:reveal style:--ln-delay={`${(i % 4) * 0.07}s`}>
        <ProductCard product={p} index={i} />
      </div>{/each}
  </div>
</section>
