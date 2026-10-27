<script lang="ts">
  import { getRuntime, isPluginSection, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import Hero from '../sections/Hero.svelte';
  import Categories from '../sections/Categories.svelte';
  import Products from '../sections/Products.svelte';
  import Features from '../sections/Features.svelte';
  import Steps from '../sections/Steps.svelte';
  import Closing from '../sections/Closing.svelte';
  import RichText from '../sections/RichText.svelte';
  import Faq from '../sections/Faq.svelte';

  /** The shop's sections (home page and its own pages), each drawn by this theme's component for its type. */
  let { sections: list, products }: { sections: SectionInstance[]; products: Product[] } = $props();
  const rt = getRuntime();
  const sections = $derived(list);
  const firstProducts = $derived(sections.find((s) => s.type === 'products')?.id);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
</script>

{#each sections as section (section.id)}
  {@const s = section.settings}
  <div data-section-id={section.id}>
    {#if section.type === 'hero'}
      <Hero heading={str(s.heading)} text={str(s.text)} coins={s.show_coins !== false} />
    {:else if section.type === 'categories' && rt.shop.categories.length}
      <Categories heading={str(s.heading)} text={str(s.text)} />
    {:else if section.type === 'products'}
      <Products
        heading={str(s.heading)}
        category={str(s.category)}
        limit={Number(s.limit) || 100}
        {products}
        anchor={section.id === firstProducts}
      />
    {:else if section.type === 'features'}
      <Features
        items={section.blocks
          .map((b) => ({ title: str(b.settings.title), text: str(b.settings.text) }))
          .filter((f) => f.title)}
      />
    {:else if section.type === 'steps'}
      <Steps heading={str(s.heading)} steps={[1, 2, 3, 4].map((n) => str(s[`step_${n}`]))} />
    {:else if section.type === 'closing'}
      <Closing heading={str(s.heading)} button={str(s.button)} />
    {:else if section.type === 'rich-text'}
      <RichText heading={str(s.heading)} text={str(s.text)} align={str(s.align)} />
    {:else if section.type === 'faq'}
      <Faq heading={str(s.heading)} items={section.blocks} />
    {:else if isPluginSection(section.type)}
      <rt.components.Slot name="section.plugin" context={{ section }} />
    {/if}
  </div>
{/each}
