<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { h2 } from '../lib/ink.ts';

  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(section.settings as { heading: string; text: string; category: string; limit: number });
  const categoryId = $derived(
    s.category ? rt.shop.categories.find((c) => c.slug === s.category || c.id === s.category)?.id : undefined,
  );
  const shown = $derived(
    (categoryId ? products.filter((p) => p.category_ids.includes(categoryId)) : products).slice(
      0,
      s.limit || 100,
    ),
  );
</script>

<section class="mb-16 flex flex-col gap-8 md:mb-24">
  {#if s.heading || s.text}
    <div class="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
      {#if s.heading}<h2 class={h2}>{s.heading}</h2>{/if}
      {#if s.text}<p class="text-lg text-pretty">{s.text}</p>{/if}
    </div>
  {/if}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each shown as p (p.id)}<ProductCard product={p} />{/each}
  </div>
</section>
