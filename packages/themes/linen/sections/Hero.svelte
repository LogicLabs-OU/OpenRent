<script lang="ts">
  import { onMount } from 'svelte';
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import DateBar from '../snippets/DateBar.svelte';
  import Headline from '../snippets/Headline.svelte';
  import { btn, btnLine, display, lead } from '../lib/linen.ts';

  /**
   * Left: a big multi-line heading with one bronze word, grey text and two pill buttons. Right: a beige media panel
   * (the photo, if any) holding the date search on a white card. Below: a label and a ticker of the categories.
   */
  let {
    section,
    products = [],
    next,
  }: { section: SectionInstance; products?: Product[]; next?: string } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as {
      heading: string;
      highlight: string;
      text: string;
      button_label: string;
      button_link: string;
      second_label: string;
      second_link: string;
      ticker_label: string;
      image: string;
      alt: string;
    },
  );
  const loc = $derived(rt.shop.locations[0]);
  const second = $derived(s.second_link || (next ? `#${next}` : ''));
  const ticker = $derived(
    rt.shop.categories.length
      ? rt.shop.categories.map((c) => ({ href: rt.url.category(c.slug), label: c.name }))
      : products.slice(0, 12).map((p) => ({ href: rt.url.product(p.slug), label: p.name })),
  );
  // Logo-like variety for the ticker: each name gets one of a few wordmark treatments.
  const marks = [
    'ln-display text-[1.75rem] font-semibold tracking-[-0.04em]',
    'ln-mono text-lg font-medium tracking-[0.12em] uppercase',
    'ln-display text-[1.6rem] font-bold tracking-[-0.03em]',
    'text-xl font-black tracking-[-0.05em] uppercase',
    'ln-display text-2xl font-medium tracking-[0.02em] lowercase',
  ];
  // The intro plays once per session; on later visits the heading simply shows.
  let intro = $state(true);
  onMount(() => {
    try {
      if (sessionStorage.getItem('ln-intro')) intro = false;
      else sessionStorage.setItem('ln-intro', '1');
    } catch {
      intro = false;
    }
  });
</script>

<section class={['mb-20 flex flex-col gap-14 md:mb-28 md:gap-20', intro && 'ln-intro']} data-section="hero">
  <div class="grid items-center gap-10 pt-2 md:pt-8 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
    <div class="flex flex-col items-start gap-7 md:gap-8">
      <Headline tag="h1" text={s.heading} mark={s.highlight} class={[display, 'max-w-[13ch]']} />
      {#if s.text}<p class={[lead, 'ln-intro-up max-w-[34rem] text-pretty']}>{s.text}</p>{/if}
      {#if s.button_label || (s.second_label && second)}
        <div class="ln-intro-up flex flex-wrap gap-3" style:--ln-delay=".1s">
          {#if s.button_label}<Button class={btn} href={s.button_link || rt.url.search?.() || rt.url.home()}
              >{s.button_label}</Button
            >{/if}
          {#if s.second_label && second}<Button variant="outline" class={btnLine} href={second}
              >{s.second_label}</Button
            >{/if}
        </div>
      {/if}
    </div>
    <div class="ln-intro-clip relative overflow-hidden rounded-[20px] bg-[var(--ln-beige)] p-3 sm:p-6 md:p-10">
      {#if s.image}<img class="absolute inset-0 size-full object-cover" src={s.image} alt={s.alt ?? ''} />{/if}
      <div class="relative flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="inline-flex h-8 items-center gap-2 rounded-full bg-white px-3.5 text-[0.8125rem] font-medium">
            <span class="size-1.5 rounded-full bg-[#2f9e5b] motion-safe:animate-pulse" aria-hidden="true"></span>{rt.t(
              'hero.live',
            )}
          </span>
          {#if products.length}<span class="ln-mono rounded-full bg-white/70 px-3 py-1.5 text-xs text-[#202020]"
              >{rt.t('hero.items', { count: products.length })}</span
            >{/if}
        </div>
        <DateBar variant="panel" />
        {#if loc}
          <div class="flex items-center gap-3 self-start rounded-2xl bg-white/80 px-4 py-3 text-sm backdrop-blur">
            <span class="grid size-8 place-items-center rounded-full bg-[var(--ln-signal)]/15" aria-hidden="true"
              ><span class="ln-square size-2"></span></span
            >
            <span class="flex flex-col leading-tight">
              <span class="font-medium">{loc.name}</span>
              {#if loc.address?.city}<span class="text-[#666]">{loc.address.city}</span>{/if}
            </span>
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if ticker.length}
    <div class="ln-intro-up flex flex-col gap-6" style:--ln-delay=".2s">
      <p class="text-[0.8125rem] font-medium">
        <span class="text-[var(--ln-accent)]">{s.ticker_label}</span>
        {rt.t('hero.categories', { count: ticker.length })}
      </p>
      <div class="ln-ticker overflow-hidden" style:--ln-ticker-time={`${Math.max(18, ticker.length * 3)}s`}>
        <div class="ln-ticker-track">
          {#each [0, 1] as copy (copy)}
            <ul class={['flex shrink-0 items-center', copy && 'ln-ticker-dup']} aria-hidden={copy ? 'true' : undefined}>
              {#each ticker as t, i (t.href)}
                <li>
                  <a
                    class={[
                      'flex h-14 items-center px-8 whitespace-nowrap text-[#202020]/75 transition-colors hover:text-[#202020] md:px-12',
                      marks[i % marks.length],
                    ]}
                    href={t.href}
                    tabindex={copy ? -1 : undefined}>{t.label}</a
                  >
                </li>
              {/each}
            </ul>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</section>
