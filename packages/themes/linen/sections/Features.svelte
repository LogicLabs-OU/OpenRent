<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import Headline from '../snippets/Headline.svelte';
  import MoreLink from '../snippets/MoreLink.svelte';
  import Visual, { type VisualKind } from '../snippets/Visual.svelte';
  import { h2, h3, subtitle } from '../lib/linen.ts';
  import { reveal, stack } from '../lib/motion.ts';

  /**
   * Big grey panels, one per block: an orange square and title, a bronze subtitle, grey text and a "Learn more"
   * link, with a beige media panel on the right. The panels stack: each sticks below the header and tilts back
   * while the next one slides over it.
   */
  let { section, products = [] }: { section: SectionInstance; products?: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(section.settings as { heading: string; highlight: string });
  const blocks = $derived(
    section.blocks.map((b) => ({
      id: b.id,
      ...(b.settings as {
        title: string;
        subtitle: string;
        text: string;
        link_label: string;
        link: string;
        visual: VisualKind;
        image: string;
        alt: string;
      }),
    })),
  );
</script>

{#if blocks.length}
  <section class="mb-20 md:mb-28" data-section="features">
    {#if s.heading}<Headline text={s.heading} mark={s.highlight} class={[h2, 'mb-10 max-w-3xl md:mb-14']} />{/if}
    <div class="ln-stack flex flex-col gap-5 md:gap-8" use:stack={rt.shop.settings.stacking !== false}>
      {#each blocks as b, i (b.id)}
        <div class="ln-stack-item">
          <article
            class="grid overflow-hidden rounded-[20px] bg-[var(--ln-panel)] lg:min-h-[34rem] lg:grid-cols-[1fr_1.05fr]"
            aria-labelledby={`ln-feature-${b.id}`}
          >
            <div class="flex flex-col items-start gap-4 p-6 pb-2 md:p-12 lg:p-14" use:reveal>
              <h3 id={`ln-feature-${b.id}`} class={[h3, 'flex items-baseline gap-4']}>
                <span class="ln-square -translate-y-0.5" aria-hidden="true"></span>{b.title}
              </h3>
              <div class="flex flex-col items-start gap-5 pl-[1.625rem]">
                {#if b.subtitle}<p class={subtitle}>{b.subtitle}</p>{/if}
                {#if b.text}<p class="max-w-[31rem] text-lg leading-[1.45] whitespace-pre-line text-[#4d4d4d]">
                    {b.text}
                  </p>{/if}
                {#if b.link_label && (b.link || rt.url.search)}<MoreLink
                    href={b.link || rt.url.search?.()}
                    label={b.link_label}
                    class="mt-1"
                  />{/if}
              </div>
            </div>
            <div class="p-3 md:p-6 lg:pl-0">
              <div
                class="relative grid h-full min-h-72 place-items-center overflow-hidden rounded-[16px] bg-[var(--ln-beige)] px-4 py-8 md:px-10"
                use:reveal={'clip'}
              >
                {#if b.image}<img
                    class="absolute inset-0 size-full object-cover"
                    src={b.image}
                    alt={b.alt ?? ''}
                    loading="lazy"
                  />{:else}<Visual kind={b.visual || (['calendar', 'prices', 'booking'] as const)[i % 3]!} {products} />{/if}
              </div>
            </div>
          </article>
        </div>
      {/each}
    </div>
  </section>
{/if}
