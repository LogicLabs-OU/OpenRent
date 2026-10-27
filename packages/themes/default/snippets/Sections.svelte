<script lang="ts">
  import type { Component } from 'svelte';
  import { getRuntime, isPluginSection, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import Hero from '../sections/Hero.svelte';
  import CategoryTiles from '../sections/CategoryTiles.svelte';
  import ProductGrid from '../sections/ProductGrid.svelte';
  import RichText from '../sections/RichText.svelte';
  import ImageText from '../sections/ImageText.svelte';
  import Faq from '../sections/Faq.svelte';

  /** The shop's sections (home page and its own pages), each drawn by this theme's component for its type. */
  let { sections: list, products }: { sections: SectionInstance[]; products: Product[] } = $props();
  const SECTIONS: Record<string, Component<{ section: SectionInstance; products: Product[] }>> = {
    hero: Hero,
    'category-tiles': CategoryTiles,
    'product-grid': ProductGrid,
    'rich-text': RichText,
    'image-text': ImageText,
    faq: Faq,
  };
  const rt = getRuntime();
</script>

{#each list as section (section.id)}
  {@const S = SECTIONS[section.type]}
  {#if S}<div data-section-id={section.id}><S {section} {products} /></div>
  {:else if isPluginSection(section.type)}<div data-section-id={section.id}>
      <rt.components.Slot name="section.plugin" context={{ section }} />
    </div>{/if}
{/each}
