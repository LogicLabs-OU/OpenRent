<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import DateBar from '../snippets/DateBar.svelte';
  import { display } from '../lib/ink.ts';

  /** Each line of the heading sits on its own lime block, stepping right; then the text, a photo and the date search. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(section.settings as { heading: string; text: string; image: string; alt: string });
  const lines = $derived(
    String(s.heading ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const step = (i: number, n: number) =>
    i === 0 ? 'md:self-start' : i === n - 1 ? 'md:self-end' : 'md:self-center';
</script>

<section class="mb-16 flex flex-col gap-8 md:mb-24 md:gap-10">
  <h1 class={[display, 'flex flex-col items-start gap-2 md:gap-3']}>
    {#each lines as l, i (i)}<span
        class={[
          'bg-primary text-primary-foreground max-w-full rounded-2xl px-4 pt-1 pb-3 md:px-7 md:pb-4',
          step(i, lines.length),
        ]}>{l}</span
      >{/each}
  </h1>
  <div class={['grid items-start gap-8', s.image && 'md:grid-cols-[1fr_1.1fr]']}>
    {#if s.image}<img
        class="aspect-[4/3] w-full rounded-2xl object-cover"
        src={s.image}
        alt={s.alt ?? ''}
      />{/if}
    <div class="flex flex-col gap-6">
      {#if s.text}<p class="max-w-2xl text-lg leading-relaxed text-pretty md:text-xl">{s.text}</p>{/if}
      <DateBar variant="panel" />
    </div>
  </div>
</section>
