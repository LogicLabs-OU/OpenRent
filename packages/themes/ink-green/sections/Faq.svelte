<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import * as Collapsible from '@openrent/ui/collapsible';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { h2 } from '../lib/ink.ts';

  /** Questions under a big heading; the plus turns into a cross when an answer is open. */
  let { section }: { section: SectionInstance } = $props();
  const heading = $derived(String(section.settings.heading ?? ''));
</script>

<section class="mb-16 grid gap-8 md:mb-24 lg:grid-cols-[1fr_1.6fr]" data-section="faq">
  {#if heading}<h2 class={h2}>{heading}</h2>{/if}
  <div class="border-t border-(--border)">
    {#each section.blocks as b (b.id)}
      <Collapsible.Root class="border-b border-(--border)">
        <Collapsible.Trigger
          class="group flex w-full items-center justify-between gap-6 py-5 text-left text-lg font-medium"
        >
          {String(b.settings.question ?? '')}
          <span
            class="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-full transition-transform group-data-[state=open]:rotate-45"
            ><PlusIcon class="size-5" /></span
          >
        </Collapsible.Trigger>
        <Collapsible.Content class="max-w-2xl pb-6 leading-relaxed whitespace-pre-line"
          >{String(b.settings.answer ?? '')}</Collapsible.Content
        >
      </Collapsible.Root>
    {/each}
  </div>
</section>
