<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { cn } from '@openrent/ui/utils';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import Accent from '../snippets/Accent.svelte';
  import { big, body, pill } from '../lib/nightfall.ts';
  import { reveal } from '../lib/motion.ts';

  /**
   * A spotlight card: an icon tile, a small label with an amber badge, a big heading, text and pill buttons,
   * with the picture on one side. Without a picture it shows a little booking calendar drawn in CSS.
   */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(
    section.settings as {
      image: string;
      alt: string;
      label: string;
      badge: string;
      heading: string;
      text: string;
      button_label: string;
      button_link: string;
      second_label: string;
      second_link: string;
      image_side: 'left' | 'right';
      glow: 'cool' | 'warm' | 'none';
    },
  );
  /** Days of the drawn calendar that look booked (a range in the accent colour). */
  const picked = (d: number) => d >= 9 && d <= 12;
</script>

<section
  class="relative mb-24 overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0a12] md:mb-36"
  data-section="image-text"
  use:reveal
>
  {#if s.glow !== 'none'}<div
      class={cn(
        'nf-glow -top-1/3 h-[140%] w-[90%] opacity-70',
        s.glow === 'warm' ? 'nf-glow-warm' : 'nf-glow-cool',
        s.image_side === 'left' ? '-right-1/4' : '-left-1/4',
      )}
      aria-hidden="true"
    ></div>{/if}
  <div class="relative grid items-stretch md:grid-cols-[1fr_1.05fr]">
    <div class="flex flex-col items-start gap-5 p-7 md:p-14">
      <span
        class="grid size-14 place-items-center rounded-2xl bg-gradient-to-b from-[color-mix(in_oklab,var(--nf-accent)_70%,white)] to-(--nf-accent) shadow-[0_10px_30px_-8px_var(--nf-accent)]"
        aria-hidden="true"><SparklesIcon class="size-7 text-white" /></span
      >
      {#if s.label || s.badge}<p class="flex items-center gap-2 text-[0.9375rem] font-semibold">
          {s.label}{#if s.badge}<span class="nf-badge">{s.badge}</span>{/if}
        </p>{/if}
      {#if s.heading}<h2 class="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance md:text-6xl">
          <Accent text={s.heading} />
        </h2>{/if}
      {#if s.text}<p class={cn(body, 'max-w-lg whitespace-pre-line')}>{s.text}</p>{/if}
      {#if (s.button_label && s.button_link) || (s.second_label && s.second_link)}
        <div class="mt-2 flex flex-wrap gap-3">
          {#if s.button_label && s.button_link}<Button class={big} href={s.button_link}>{s.button_label}</Button>{/if}
          {#if s.second_label && s.second_link}<Button class={pill} href={s.second_link}
              >{s.second_label}<ArrowRightIcon /></Button
            >{/if}
        </div>
      {/if}
    </div>
    <div class={cn('relative min-h-72 md:min-h-[520px]', s.image_side === 'left' && 'md:order-first')}>
      {#if s.image}<img
          class="absolute inset-0 size-full object-cover"
          src={s.image}
          alt={s.alt ?? ''}
          loading="lazy"
        />{:else}
        <div class="nf-dots absolute inset-0 grid place-items-center p-6 md:p-12" aria-hidden="true">
          <div class="nf-glass w-full max-w-sm rounded-3xl p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            <div class="mb-5 flex items-center gap-3">
              <span class="size-10 rounded-xl bg-gradient-to-br from-[#e3bd00] to-[#d48a00]"></span>
              <span class="flex flex-1 flex-col gap-2">
                <span class="h-2.5 w-2/3 rounded-full bg-white/70"></span>
                <span class="h-2 w-1/3 rounded-full bg-white/25"></span>
              </span>
            </div>
            <div class="grid grid-cols-7 gap-1.5">
              {#each Array.from({ length: 28 }, (_, d) => d) as d (d)}
                <span
                  class={cn(
                    'aspect-square rounded-lg',
                    picked(d) ? 'bg-(--nf-accent)' : d % 9 === 4 ? 'bg-white/5' : 'bg-white/10',
                    (d === 9 || d === 12) && 'ring-2 ring-white/70',
                  )}
                ></span>
              {/each}
            </div>
            <div class="mt-5 flex items-center justify-between gap-3">
              <span class="h-2.5 w-1/3 rounded-full bg-white/30"></span>
              <span class="h-9 w-28 rounded-full bg-white"></span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>
