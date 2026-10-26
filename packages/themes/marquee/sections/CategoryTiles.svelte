<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
  import { h2, pad } from '../lib/marquee.ts';
  import { reveal } from '../lib/motion.ts';

  /**
   * Categories as a ruled programme board: a running number and the item count in mono, the name in big
   * condensed capitals; blue floods in from the left on hover.
   */
  let { section, products = [] }: { section: SectionInstance; products?: Product[] } = $props();
  const rt = getRuntime();
  const heading = $derived(String(section.settings.heading ?? ''));
  const count = (id: string) => products.filter((p) => p.category_ids.includes(id)).length;
</script>

{#if rt.shop.categories.length}
  <section class="mb-16 flex flex-col gap-8 md:mb-24" data-section="category-tiles">
    {#if heading}<h2 class={h2}>{heading}</h2>{/if}
    <ul class="mq-cells grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {#each rt.shop.categories as c, i (c.id)}
        <li class="flex" use:reveal={(i % 4) * 70}>
          <a
            class="mq-fill group flex min-h-40 w-full flex-col justify-between gap-8 p-5 md:min-h-52 md:p-6"
            href={rt.url.category(c.slug)}
          >
            <span class="flex items-start justify-between gap-3">
              <span class="mq-mono text-[0.8125rem]">{pad(i + 1)}</span>
              <ArrowUpRightIcon class="mq-arrow size-6" aria-hidden="true" />
            </span>
            <span class="flex flex-col gap-2">
              <span class="mq-tight text-[clamp(2.25rem,3.6vw,3.25rem)] leading-[0.88] font-bold break-words uppercase"
                >{c.name}</span
              >
              {#if products.length}<span class="mq-mono text-[0.8125rem] uppercase"
                  >{rt.t('grid.count', { count: count(c.id) })}</span
                >{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
