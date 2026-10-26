<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import * as Collapsible from '@openrent/ui/collapsible';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { h2, pad } from '../lib/marquee.ts';
  import { reveal } from '../lib/motion.ts';

  /** Numbered questions in ruled rows; the plus in its square cell turns into a cross when an answer is open. */
  let { section }: { section: SectionInstance } = $props();
  const heading = $derived(String(section.settings.heading ?? ''));
</script>

<section class="mb-16 grid gap-8 md:mb-24 lg:grid-cols-[1fr_2fr] lg:gap-12" data-section="faq" use:reveal>
  {#if heading}<h2 class={[h2, 'lg:sticky lg:top-[calc(var(--mq-head)+1.5rem)] lg:self-start']}>{heading}</h2>{/if}
  <div class="border-t border-(--mq-ink)">
    {#each section.blocks as b, i (b.id)}
      <Collapsible.Root class="border-b border-(--mq-ink)">
        <Collapsible.Trigger
          class="group flex w-full items-center gap-4 py-4 text-left hover:text-(--mq-accent) md:gap-6 md:py-5"
        >
          <span class="mq-mono w-8 shrink-0 text-sm">{pad(i + 1)}</span>
          <span class="mq-tight flex-1 text-2xl leading-[0.95] font-bold uppercase md:text-[2rem]"
            >{String(b.settings.question ?? '')}</span
          >
          <span
            class="grid size-11 shrink-0 place-items-center border border-current transition-[transform,background-color] duration-400 group-data-[state=open]:rotate-45 group-data-[state=open]:bg-(--mq-accent) group-data-[state=open]:text-(--mq-on-accent)"
            ><PlusIcon class="size-5" aria-hidden="true" /></span
          >
        </Collapsible.Trigger>
        <Collapsible.Content class="max-w-2xl pb-6 pl-12 text-lg leading-snug whitespace-pre-line md:pl-14"
          >{String(b.settings.answer ?? '')}</Collapsible.Content
        >
      </Collapsible.Root>
    {/each}
  </div>
</section>
