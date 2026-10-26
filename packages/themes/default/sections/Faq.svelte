<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import * as Collapsible from '@openrent/ui/collapsible';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

  let { section }: { section: SectionInstance } = $props();
  const heading = $derived(String(section.settings.heading ?? ''));
</script>

<section class="mb-10 flex max-w-3xl flex-col gap-3" data-section="faq">
  {#if heading}<h2 class="text-2xl font-semibold tracking-tight">{heading}</h2>{/if}
  <div class="divide-y rounded-xl border">
    {#each section.blocks as b (b.id)}
      <Collapsible.Root>
        <Collapsible.Trigger
          class="group flex w-full items-center justify-between gap-4 px-4 py-3 text-left font-medium"
        >
          {String(b.settings.question ?? '')}
          <ChevronDownIcon class="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Content class="text-muted-foreground px-4 pb-4 leading-7 whitespace-pre-line"
          >{String(b.settings.answer ?? '')}</Collapsible.Content
        >
      </Collapsible.Root>
    {/each}
  </div>
</section>
