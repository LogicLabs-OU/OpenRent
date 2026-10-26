<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import * as Collapsible from '@openrent/ui/collapsible';
  import { col, h2, row } from '../lib/concept.ts';

  /** Questions as toggle blocks: a triangle that turns, the answer indented under it. */
  let { section }: { section: SectionInstance } = $props();
  const heading = $derived(String(section.settings.heading ?? ''));
</script>

<section class={[col, 'mb-10 flex flex-col gap-1']} data-section="faq">
  {#if heading}<h2 class={[h2, 'mb-2']}>{heading}</h2>{/if}
  {#each section.blocks as b (b.id)}
    <Collapsible.Root>
      <Collapsible.Trigger
        class={[row, 'group flex w-full items-start gap-1.5 py-1 pr-2 pl-0.5 text-left font-medium']}
      >
        <svg
          class="mt-[7px] size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          viewBox="0 0 12 12"
          aria-hidden="true"><path d="M3.5 1.8 9.5 6l-6 4.2z" fill="currentColor" /></svg
        >
        {String(b.settings.question ?? '')}
      </Collapsible.Trigger>
      <Collapsible.Content class="pt-0.5 pb-2 pl-[1.375rem] leading-7 whitespace-pre-line"
        >{String(b.settings.answer ?? '')}</Collapsible.Content
      >
    </Collapsible.Root>
  {/each}
</section>
