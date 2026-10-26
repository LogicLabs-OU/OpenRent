<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';

  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { heading: string; text: string });
</script>

<section class="flex flex-col gap-3 py-6 md:py-10">
  <h1 class="max-w-3xl text-3xl font-semibold tracking-tight text-balance md:text-5xl">{s.heading}</h1>
  {#if s.text}<p class="text-muted-foreground max-w-2xl text-lg text-pretty">{s.text}</p>{/if}
</section>
