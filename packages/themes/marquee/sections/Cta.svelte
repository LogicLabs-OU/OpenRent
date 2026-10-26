<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { reveal } from '../lib/motion.ts';

  /** A closing bill in signal orange: a giant heading, a line of text and boxed buttons, over a halftone corner. */
  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as {
      heading: string;
      text: string;
      button_label: string;
      button_link: string;
      second_label: string;
      second_link: string;
    },
  );
  const lines = $derived(
    String(s.heading ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
</script>

<section
  class="relative mb-16 overflow-hidden border border-(--mq-ink) bg-(--mq-accent-2) text-(--mq-on-accent-2) md:mb-24"
  data-section="cta"
  use:reveal
>
  <div class="mq-halftone absolute inset-y-0 right-0 w-1/2 [mask-image:linear-gradient(to_left,#000,transparent)]" aria-hidden="true"></div>
  <div class="relative flex flex-col items-start gap-8 p-6 md:p-12 lg:p-16">
    {#if lines.length}<h2
        class="mq-tight text-[clamp(3rem,8vw,7.5rem)] leading-[0.86] font-bold break-words uppercase [--mq-stroke:var(--mq-on-accent-2)]"
      >
        {#each lines as l, i (i)}<span class={['block', i % 2 === 1 && 'mq-outline']}>{l}</span>{/each}
      </h2>{/if}
    {#if s.text}<p class="max-w-xl text-xl leading-snug font-semibold uppercase">{s.text}</p>{/if}
    <div class="flex flex-wrap gap-3">
      {#if s.button_label}<a
          class="mq-fill flex h-14 items-center gap-4 bg-(--mq-ink) px-6 text-xl font-bold text-(--mq-paper) uppercase [--mq-fill:var(--mq-accent)]"
          href={s.button_link || rt.url.search?.() || rt.url.home()}
          >{s.button_label}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></a
        >{/if}
      {#if s.second_label && s.second_link}<a
          class="mq-fill flex h-14 items-center gap-4 border border-current px-6 text-xl font-bold uppercase [--mq-fill:var(--mq-ink)] [--mq-fill-text:var(--mq-paper)]"
          href={s.second_link}>{s.second_label}</a
        >{/if}
    </div>
  </div>
</section>
