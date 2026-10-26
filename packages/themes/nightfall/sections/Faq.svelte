<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import * as Collapsible from '@openrent/ui/collapsible';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Accent from '../snippets/Accent.svelte';
  import { body, h2 } from '../lib/nightfall.ts';
  import { reveal } from '../lib/motion.ts';

  /** Questions as glass rows next to the heading; the plus turns into a cross when an answer is open. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { heading: string; text: string });
</script>

<section
  id={section.id === 'faq' ? 'faq' : undefined}
  class="mb-24 grid scroll-mt-24 gap-10 md:mb-36 lg:grid-cols-[1fr_1.5fr] lg:gap-16"
  data-section="faq"
>
  <div class="flex flex-col gap-4" use:reveal>
    {#if s.heading}<h2 class={h2}><Accent text={s.heading} /></h2>{/if}
    {#if s.text}<p class={body}>{s.text}</p>{/if}
  </div>
  <div class="flex flex-col gap-3">
    {#each section.blocks as b, i (b.id)}
      <div use:reveal={i * 70}>
        <Collapsible.Root class="nf-glass rounded-3xl px-5 md:px-7">
          <Collapsible.Trigger
            class="group flex w-full items-center justify-between gap-6 py-5 text-left text-base font-semibold outline-none focus-visible:underline md:text-lg"
          >
            {String(b.settings.question ?? '')}
            <span
              class="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 transition-transform duration-300 group-data-[state=open]:rotate-45"
              ><PlusIcon class="size-4" /></span
            >
          </Collapsible.Trigger>
          <Collapsible.Content class="max-w-2xl pb-6 text-[0.9375rem] leading-relaxed whitespace-pre-line text-white/70"
            >{String(b.settings.answer ?? '')}</Collapsible.Content
          >
        </Collapsible.Root>
      </div>
    {/each}
  </div>
</section>
