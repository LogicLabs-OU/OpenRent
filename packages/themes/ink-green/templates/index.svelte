<script lang="ts">
  import type { Component } from 'svelte';
  import type { IndexData, Product, SectionInstance } from '@openrent/theme-sdk';
  import Hero from '../sections/Hero.svelte';
  import CategoryTiles from '../sections/CategoryTiles.svelte';
  import ProductGrid from '../sections/ProductGrid.svelte';
  import RichText from '../sections/RichText.svelte';
  import ImageText from '../sections/ImageText.svelte';
  import Faq from '../sections/Faq.svelte';
  import Cta from '../sections/Cta.svelte';

  /** The home page is the shop's list of sections (Admin → Themes → Sections). */
  let { data }: { data: IndexData } = $props();
  const SECTIONS: Record<string, Component<{ section: SectionInstance; products: Product[] }>> = {
    hero: Hero,
    'category-tiles': CategoryTiles,
    'product-grid': ProductGrid,
    'rich-text': RichText,
    'image-text': ImageText,
    faq: Faq,
    cta: Cta,
  };
</script>

{#each data.sections ?? [] as section (section.id)}
  {@const S = SECTIONS[section.type]}
  {#if S}<div data-section-id={section.id}><S {section} products={data.products} /></div>{/if}
{/each}
