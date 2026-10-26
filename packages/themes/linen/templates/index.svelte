<script lang="ts">
  import type { Component } from 'svelte';
  import type { IndexData, Product, SectionInstance } from '@openrent/theme-sdk';
  import Hero from '../sections/Hero.svelte';
  import Features from '../sections/Features.svelte';
  import CategoryTiles from '../sections/CategoryTiles.svelte';
  import ProductGrid from '../sections/ProductGrid.svelte';
  import RichText from '../sections/RichText.svelte';
  import ImageText from '../sections/ImageText.svelte';
  import Faq from '../sections/Faq.svelte';
  import Cta from '../sections/Cta.svelte';

  /** The home page is the shop's list of sections (Admin → Themes → Sections). */
  let { data }: { data: IndexData } = $props();
  const SECTIONS: Record<
    string,
    Component<{ section: SectionInstance; products: Product[]; next?: string }>
  > = {
    hero: Hero,
    features: Features,
    'category-tiles': CategoryTiles,
    'product-grid': ProductGrid,
    'rich-text': RichText,
    'image-text': ImageText,
    faq: Faq,
    cta: Cta,
  };
  const sections = $derived((data.sections ?? []).filter((s) => SECTIONS[s.type]));
</script>

{#each sections as section, i (section.id)}
  {@const S = SECTIONS[section.type]!}
  <!-- The id lets buttons link to a section; the margin keeps it clear of the sticky header. -->
  <div id={section.id} class="scroll-mt-28" data-section-id={section.id}>
    <S {section} products={data.products} next={sections[i + 1]?.id} />
  </div>
{/each}
