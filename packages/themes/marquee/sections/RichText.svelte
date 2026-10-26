<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import Scribble from '../snippets/Scribble.svelte';
  import { h2 } from '../lib/marquee.ts';
  import { reveal } from '../lib/motion.ts';

  /** A big heading underlined by a blue pen stroke, then plain paragraphs (blank lines separate them; no HTML). */
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
    'mb-16 flex max-w-4xl flex-col gap-8 md:mb-24',
    s.align === 'center' && 'mx-auto items-center text-center',
  ]}
  data-section="rich-text"
  use:reveal
>
  {#if s.heading}<h2 class={[h2, 'relative w-fit md:text-[5.5rem]']}>{s.heading}<Scribble /></h2>{/if}
  <div class="flex max-w-2xl flex-col gap-4">
    {#each paragraphs as p, i (i)}<p class="text-xl leading-snug whitespace-pre-line">{p}</p>{/each}
  </div>
</section>
