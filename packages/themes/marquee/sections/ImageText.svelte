<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import Poster from '../snippets/Poster.svelte';
  import { h2 } from '../lib/marquee.ts';
  import { reveal } from '../lib/motion.ts';

  /** A ruled two-cell box: a photo framed with crop marks (or a printed stand-in) and a block of text. */
  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as {
      image: string;
      alt: string;
      heading: string;
      text: string;
      button_label: string;
      button_link: string;
      image_side: 'left' | 'right';
      tone: 'paper' | 'accent' | 'accent_2';
    },
  );
  const TONES = {
    paper: 'bg-(--mq-paper) text-(--mq-ink)',
    accent: 'bg-(--mq-accent) text-(--mq-on-accent)',
    accent_2: 'bg-(--mq-accent-2) text-(--mq-on-accent-2)',
  };
</script>

<section class="mq-cells mb-16 grid md:mb-24 md:grid-cols-2" data-section="image-text" use:reveal>
  <div class={['bg-(--mq-paper) p-6 md:p-10', s.image_side === 'right' && 'md:order-2']}>
    <div class="mq-crop relative aspect-[4/3] border border-(--mq-ink) bg-white p-2">
      <div class="size-full overflow-hidden">
        {#if s.image}<img class="size-full object-cover" src={s.image} alt={s.alt} loading="lazy" />{:else}<Poster
            name={s.heading || rt.shop.tenant.name}
            tag={rt.shop.tenant.name}
          />{/if}
      </div>
    </div>
  </div>
  <div class={['flex flex-col items-start justify-end gap-6 p-6 md:p-10', TONES[s.tone] ?? TONES.paper]}>
    {#if s.heading}<h2 class={h2}>{s.heading}</h2>{/if}
    {#if s.text}<p class="max-w-xl text-xl leading-snug whitespace-pre-line">{s.text}</p>{/if}
    {#if s.button_label && s.button_link}<a
        class="mq-fill flex h-14 items-center gap-4 border border-current px-6 text-xl font-bold uppercase [--mq-fill:var(--mq-ink)] [--mq-fill-text:var(--mq-paper)]"
        href={s.button_link}>{s.button_label}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></a
      >{/if}
  </div>
</section>
