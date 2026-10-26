<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { cn } from '@openrent/ui/utils';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import Accent from '../snippets/Accent.svelte';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { body, h2, pill } from '../lib/nightfall.ts';
  import { reveal, scrollProgress } from '../lib/motion.ts';

  /** Products on a plane tilted back in 3D that flattens as it scrolls into view, over an amber glow. */
  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as {
      label: string;
      heading: string;
      text: string;
      category: string;
      limit: number;
      tilt: boolean;
      button_label: string;
    },
  );
  const category = $derived(
    s.category ? rt.shop.categories.find((c) => c.slug === s.category || c.id === s.category) : undefined,
  );
  const shown = $derived(
    (category ? products.filter((p) => p.category_ids.includes(category.id)) : products).slice(0, s.limit || 100),
  );
  const more = $derived(category ? rt.url.category(category.slug) : (rt.url.search?.() ?? rt.url.home()));
  const grid = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-5';
</script>

<section class="relative mb-24 md:mb-36" data-section="product-grid">
  {#if s.label || s.heading || s.text}
    <div class="mx-auto mb-12 flex max-w-3xl flex-col items-center gap-4 text-center md:mb-16" use:reveal>
      {#if s.label}<p class="text-[0.8125rem] font-semibold text-white/60">{s.label}</p>{/if}
      {#if s.heading}<h2 class={h2}><Accent text={s.heading} /></h2>{/if}
      {#if s.text}<p class={cn(body, 'text-pretty')}>{s.text}</p>{/if}
    </div>
  {/if}
  {#if s.tilt !== false}
    <div class="nf-tilt relative" use:scrollProgress={{ from: 1, to: 0.3 }}>
      <div
        class="nf-glow nf-glow-warm top-[8%] left-1/2 h-[min(80%,900px)] w-[min(1200px,130vw)] -translate-x-1/2 opacity-60"
        aria-hidden="true"
      ></div>
      <div class={cn('nf-plane relative', grid)}>
        {#each shown as p (p.id)}<ProductCard product={p} />{/each}
      </div>
    </div>
  {:else}
    <div class={grid}>
      {#each shown as p, i (p.id)}<div use:reveal={(i % 4) * 80}><ProductCard product={p} /></div>{/each}
    </div>
  {/if}
  {#if s.button_label}
    <div class="mt-12 flex justify-center">
      <Button class={pill} href={more}>{s.button_label}<ArrowRightIcon /></Button>
    </div>
  {/if}
</section>
