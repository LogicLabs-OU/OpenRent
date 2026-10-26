<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { h2 } from '../lib/ink.ts';

  /** Plain paragraphs: blank lines separate them; no HTML is rendered. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { heading: string; text: string; align: 'left' | 'center' });
  const paragraphs = $derived(
    s.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  );
</script>

<section
  class={[
    'mb-16 flex max-w-3xl flex-col gap-5 md:mb-24',
    s.align === 'center' && 'mx-auto items-center text-center',
  ]}
>
  {#if s.heading}<h2 class={h2}>{s.heading}</h2>{/if}
  {#each paragraphs as p, i (i)}<p class="text-lg leading-relaxed whitespace-pre-line">{p}</p>{/each}
</section>
