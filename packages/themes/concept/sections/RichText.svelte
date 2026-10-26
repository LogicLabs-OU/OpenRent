<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { col, h2 } from '../lib/concept.ts';

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

<section class={[col, 'mb-10 flex flex-col gap-2', s.align === 'center' && 'items-center text-center']}>
  {#if s.heading}<h2 class={[h2, 'mb-1']}>{s.heading}</h2>{/if}
  {#each paragraphs as p, i (i)}<p class="max-w-[70ch] leading-7 whitespace-pre-line">{p}</p>{/each}
</section>
