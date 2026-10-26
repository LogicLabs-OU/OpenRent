<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { cn } from '@openrent/ui/utils';
  import Accent from '../snippets/Accent.svelte';
  import { body, h2 } from '../lib/nightfall.ts';
  import { reveal } from '../lib/motion.ts';

  /** Plain paragraphs under a heading: blank lines separate them; no HTML is rendered. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { heading: string; text: string; align: 'left' | 'center' });
  const paragraphs = $derived(
    String(s.text ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  );
</script>

<section
  class={cn('mb-24 flex max-w-3xl flex-col gap-6 md:mb-36', s.align === 'center' && 'mx-auto items-center text-center')}
  data-section="rich-text"
  use:reveal
>
  {#if s.heading}<h2 class={h2}><Accent text={s.heading} /></h2>{/if}
  {#each paragraphs as p, i (i)}<p class={cn(body, 'whitespace-pre-line')}>{p}</p>{/each}
</section>
