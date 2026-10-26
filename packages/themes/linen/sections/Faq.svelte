<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import * as Collapsible from '@openrent/ui/collapsible';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Headline from '../snippets/Headline.svelte';
  import { h2, lead } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

  /** The heading on the left; on the right, white cards that open into answers, the plus turning into a cross. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { heading: string; highlight: string; text: string });
</script>

<section class="mb-20 grid gap-10 md:mb-28 lg:grid-cols-[1fr_1.5fr] lg:gap-16" data-section="faq">
  <div class="flex flex-col gap-5 lg:sticky lg:top-28 lg:self-start">
    {#if s.heading}<Headline text={s.heading} mark={s.highlight} class={h2} />{/if}
    {#if s.text}<p class={[lead, 'max-w-md']} use:reveal>{s.text}</p>{/if}
  </div>
  <div class="flex flex-col gap-2">
    {#each section.blocks as b, i (b.id)}
      <div use:reveal style:--ln-delay={`${Math.min(i, 5) * 0.06}s`}>
        <Collapsible.Root class="group/faq rounded-xl bg-white transition-colors">
          <Collapsible.Trigger
            class="flex w-full items-center justify-between gap-6 rounded-xl px-5 py-5 text-left text-[1.0625rem] font-medium outline-none focus-visible:ring-3 focus-visible:ring-[var(--ln-accent)]/50 md:px-7"
          >
            <span class="flex items-baseline gap-3"
              ><span class="ln-square size-2 -translate-y-px" aria-hidden="true"></span>{String(
                b.settings.question ?? '',
              )}</span
            >
            <span
              class="grid size-8 shrink-0 place-items-center rounded-full border border-[#202020]/15 transition-[transform,background-color,color] duration-300 group-data-[state=open]/faq:rotate-45 group-data-[state=open]/faq:border-transparent group-data-[state=open]/faq:bg-[var(--ln-accent)] group-data-[state=open]/faq:text-white"
              ><PlusIcon class="size-4" /></span
            >
          </Collapsible.Trigger>
          <Collapsible.Content
            class="max-w-2xl px-5 pb-6 pl-10 text-base leading-relaxed whitespace-pre-line text-[#4d4d4d] md:px-7 md:pl-12"
            >{String(b.settings.answer ?? '')}</Collapsible.Content
          >
        </Collapsible.Root>
      </div>
    {/each}
  </div>
</section>
