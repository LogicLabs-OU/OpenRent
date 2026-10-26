<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import Headline from '../snippets/Headline.svelte';
  import MoreLink from '../snippets/MoreLink.svelte';
  import { h2, lead } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

  /** Categories as grey tiles: a mono index and item count, the name beside an orange square, "Browse ›". */
  let { section, products = [] }: { section: SectionInstance; products?: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(section.settings as { heading: string; highlight: string; text: string });
  const count = (id: string) => products.filter((p) => p.category_ids.includes(id)).length;
</script>

{#if rt.shop.categories.length}
  <section class="mb-20 flex flex-col gap-10 md:mb-28 md:gap-14" data-section="category-tiles">
    {#if s.heading || s.text}
      <div class="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr]">
        {#if s.heading}<Headline text={s.heading} mark={s.highlight} class={h2} />{/if}
        {#if s.text}<p class={[lead, 'max-w-xl lg:justify-self-end']} use:reveal>{s.text}</p>{/if}
      </div>
    {/if}
    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each rt.shop.categories as c, i (c.id)}
        {@const n = count(c.id)}
        <li use:reveal style:--ln-delay={`${(i % 3) * 0.08}s`}>
          <a
            class="group flex h-full min-h-32 flex-col justify-between gap-5 rounded-xl bg-[var(--ln-panel)] p-5 sm:min-h-44 sm:gap-8 sm:p-6 transition-colors duration-300 outline-none hover:bg-white focus-visible:ring-3 focus-visible:ring-[var(--ln-accent)]/50 md:p-7"
            href={rt.url.category(c.slug)}
          >
            <span class="ln-mono flex items-center justify-between gap-3 text-xs text-[#666]">
              <span>{String(i + 1).padStart(2, '0')}</span>
              {#if n}<span>{rt.t('hero.items', { count: n })}</span>{/if}
            </span>
            <span class="flex flex-col gap-3">
              <span class="ln-display flex items-baseline gap-3 text-[1.75rem] leading-tight tracking-[-0.015em]"
                ><span class="ln-square -translate-y-0.5" aria-hidden="true"></span>{c.name}</span
              >
              <MoreLink label={rt.t('categories.browse')} class="pl-[1.375rem] text-[0.9375rem]" />
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
