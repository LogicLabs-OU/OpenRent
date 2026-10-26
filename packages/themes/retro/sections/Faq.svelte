<script lang="ts">
  import type { SectionBlock } from '@openrent/theme-sdk';
  import * as Collapsible from '@openrent/ui/collapsible';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { display, wrap } from '../lib/retro.ts';

  let { heading, items }: { heading: string; items: SectionBlock[] } = $props();
</script>

<section class={[wrap, 'flex flex-col items-center gap-10 py-16 md:py-24']} data-section="faq">
  {#if heading}<h2 class={[display, 'text-center']}>{heading}</h2>{/if}
  <div class="flex w-full max-w-3xl flex-col gap-3">
    {#each items as b (b.id)}
      <Collapsible.Root class="rounded-[1.25rem] border border-black bg-white">
        <Collapsible.Trigger
          class="group flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-lg md:text-xl"
        >
          {String(b.settings.question ?? '')}
          <span
            class="grid size-9 shrink-0 place-items-center rounded-full border border-black bg-(--retro-accent) transition-transform group-data-[state=open]:rotate-45"
            aria-hidden="true"><PlusIcon class="size-5" /></span
          >
        </Collapsible.Trigger>
        <Collapsible.Content class="px-6 pb-6 text-lg leading-relaxed whitespace-pre-line"
          >{String(b.settings.answer ?? '')}</Collapsible.Content
        >
      </Collapsible.Root>
    {/each}
  </div>
</section>
