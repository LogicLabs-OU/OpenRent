<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import Headline from '../snippets/Headline.svelte';
  import { h2, lead } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

  /** A large heading with one bronze word over grey paragraphs: blank lines separate them; no HTML is rendered. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { heading: string; highlight: string; text: string; align: 'left' | 'center' });
  const paragraphs = $derived(
    String(s.text ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  );
</script>

<section
  class={[
    'mb-20 flex max-w-4xl flex-col gap-6 py-4 md:mb-28 md:py-10',
    s.align === 'center' && 'mx-auto items-center text-center',
  ]}
  data-section="rich-text"
>
  {#if s.heading}<Headline text={s.heading} mark={s.highlight} class={h2} />{/if}
  <div class={['flex max-w-2xl flex-col gap-4', s.align === 'center' && 'items-center']} use:reveal>
    {#each paragraphs as p, i (i)}<p class={[lead, 'whitespace-pre-line text-pretty']}>{p}</p>{/each}
  </div>
</section>
