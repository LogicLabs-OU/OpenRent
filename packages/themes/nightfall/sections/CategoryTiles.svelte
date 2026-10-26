<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { cn } from '@openrent/ui/utils';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import Accent from '../snippets/Accent.svelte';
  import ProductArt from '../snippets/ProductArt.svelte';
  import { categoryIcon } from '../lib/icons.ts';
  import { reducedMotion, reveal } from '../lib/motion.ts';
  import { body, h2, label, pill } from '../lib/nightfall.ts';

  /**
   * A row of rounded category tiles over a deep blue glow, and below it a carousel of large dark cards, one per
   * category, with a few of its products. It advances on its own (pausable, never under reduced motion).
   */
  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(section.settings as { heading: string; text: string });
  const cats = $derived(rt.shop.categories);
  const SLIDE_MS = 6500;

  let active = $state(0);
  let paused = $state(false);
  let holding = $state(false);
  let auto = $state(false);
  let visible = $state(false);
  let run = $state(0);
  let offset = $state(0);
  let root: HTMLElement | undefined = $state();
  let track: HTMLElement | undefined = $state();
  let tiles: HTMLElement | undefined = $state();

  const running = $derived(auto && !paused && !holding && visible && cats.length > 1);
  const items = (id: string) => products.filter((p) => p.category_ids.includes(id));

  function place() {
    const slides = track?.children;
    if (!slides?.length) return;
    offset = (slides[active] as HTMLElement).offsetLeft - (slides[0] as HTMLElement).offsetLeft;
  }

  async function go(i: number, user = false) {
    active = (i + cats.length) % cats.length;
    if (user) run++;
    await tick();
    place();
    // Keep the chosen tile in view inside its own scroller, without moving the page.
    const tile = tiles?.children[active] as HTMLElement | undefined;
    if (tile && tiles && tiles.scrollWidth > tiles.clientWidth)
      tiles.scrollTo({
        left: tile.offsetLeft - tiles.clientWidth / 2 + tile.clientWidth / 2,
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
  }

  onMount(() => {
    auto = !reducedMotion() && !root?.closest('[data-nf-motion="off"]');
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting), { threshold: 0.25 });
    if (root) io.observe(root);
    addEventListener('resize', place);
    return () => {
      io.disconnect();
      removeEventListener('resize', place);
    };
  });

  $effect(() => {
    if (!running) return;
    void run;
    const id = setTimeout(() => go(active + 1), SLIDE_MS);
    return () => clearTimeout(id);
  });

  function keys(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') go(active + 1, true);
    else if (e.key === 'ArrowLeft') go(active - 1, true);
    else return;
    e.preventDefault();
  }
  const roundBtn =
    'grid size-11 place-items-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:ring-4 focus-visible:ring-ring/60 outline-none';
</script>

{#if cats.length}
  <section
    bind:this={root}
    class="relative mb-24 md:mb-36"
    data-section="category-tiles"
    aria-labelledby={s.heading ? `nf-cats-${section.id}` : undefined}
  >
    <div
      class="nf-glow nf-glow-cool top-0 left-1/2 h-[560px] w-[min(1300px,150vw)] -translate-x-1/2 opacity-80"
      aria-hidden="true"
    ></div>
    <div class="relative flex flex-col items-center gap-5 text-center" use:reveal>
      {#if s.heading}<h2 id={`nf-cats-${section.id}`} class={cn(h2, 'max-w-4xl')}><Accent text={s.heading} /></h2>{/if}
      {#if s.text}<p class={cn(body, 'max-w-2xl')}>{s.text}</p>{/if}
    </div>

    <div class="relative -mx-4 mt-10 overflow-x-auto px-4 py-2 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)] [scrollbar-width:none] md:mt-12" bind:this={tiles}>
      <div class="mx-auto flex w-max gap-3" role="group" aria-label={rt.t('nav.categories')}>
        {#each cats as c, i (c.id)}
          {@const Icon = categoryIcon(c.name, c.slug)}
          <button
            type="button"
            class={cn(
              'nf-tile relative flex h-24 min-w-28 shrink-0 flex-col items-center justify-center gap-2 rounded-3xl border px-4 text-[0.8125rem] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/60 md:min-w-32',
              i === active
                ? 'border-white/20 bg-[#0b0a12]/90 text-white'
                : 'border-white/5 bg-[#0b0a12]/55 text-white/70 hover:bg-[#0b0a12]/80 hover:text-white',
            )}
            aria-pressed={i === active}
            onclick={() => go(i, true)}
          >
            <Icon class={cn('size-6', i === active ? 'text-[color:var(--nf-accent-text)]' : '')} aria-hidden="true" />
            <span class="max-w-48 truncate">{c.name}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Arrow keys move the slides while focus is anywhere inside the carousel. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="relative mt-8"
      role="region"
      aria-roledescription="carousel"
      aria-label={s.heading ? s.heading.replace(/\*/g, '') : rt.t('nav.categories')}
      onmouseenter={() => (holding = true)}
      onmouseleave={() => (holding = false)}
      onfocusin={() => (holding = true)}
      onfocusout={() => (holding = false)}
      onkeydown={keys}
    >
      <div
        bind:this={track}
        class="flex gap-4 transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none md:gap-6"
        style:transform={`translate3d(${-offset}px,0,0)`}
        aria-live={running ? 'off' : 'polite'}
      >
        {#each cats as c, i (c.id)}
          {@const list = items(c.id)}
          <div
            class={cn(
              'grid w-[88%] shrink-0 overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0a12] transition-opacity duration-500 md:w-[82%] md:grid-cols-2',
              i !== active && 'opacity-50',
            )}
            role="group"
            aria-roledescription="slide"
            aria-label={rt.t('carousel.slide', { n: i + 1, count: cats.length })}
            inert={i !== active}
          >
            <div class="flex flex-col items-start justify-end gap-4 p-7 md:min-h-[440px] md:p-12">
              <p class={label}>{c.name}</p>
              <h3 class="text-3xl leading-[1.08] font-semibold tracking-[-0.03em] text-balance md:text-5xl">
                {rt.t('categories.slide_heading', { name: c.name })}
              </h3>
              <p class="text-base text-white/70">
                {list.length ? rt.t('categories.count', { count: list.length }) : rt.t('categories.soon')}
              </p>
              <Button class={cn(pill, 'mt-2 h-11')} href={rt.url.category(c.slug)}
                >{rt.t('categories.browse')}<ArrowRightIcon /></Button
              >
            </div>
            <div class="nf-dots flex flex-col justify-center gap-3 border-t border-white/10 bg-[#121118] p-5 md:border-t-0 md:border-l md:p-10">
              {#each list.slice(0, 3) as p (p.id)}
                <a
                  class="flex items-center gap-4 rounded-2xl border border-white/10 bg-[#18181b]/90 p-3 transition-colors hover:border-white/25"
                  href={rt.url.product(p.slug)}
                >
                  <span class="size-12 shrink-0 overflow-hidden rounded-xl">
                    {#if p.images[0]}<img
                        class="size-full object-cover"
                        src={p.images[0].url_sm ?? p.images[0].url}
                        alt=""
                        loading="lazy"
                      />{:else}<ProductArt name={p.name} size="sm" />{/if}
                  </span>
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-[0.9375rem] font-semibold">{p.name}</span>
                    <span class="truncate text-[0.8125rem] text-white/60"
                      >{p.variants.find((v) => v.price)?.price?.description ?? ''}</span
                    >
                  </span>
                </a>
              {:else}
                {@const Icon = categoryIcon(c.name, c.slug)}
                <div class="grid place-items-center py-6 text-white/25 md:py-10" aria-hidden="true">
                  <Icon class="size-16 md:size-24" strokeWidth={1} />
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      {#if cats.length > 1}
        <div class="mt-6 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span
              class="flex h-11 items-center rounded-full border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 tabular-nums sm:hidden"
              >{active + 1} / {cats.length}</span
            >
            <div class="hidden h-11 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 sm:flex">
              {#each cats as c, i (c.id)}
                <button
                  type="button"
                  class={cn(
                    'relative h-2 overflow-hidden rounded-full transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    i === active ? 'w-8 bg-white/25' : 'w-2 bg-white/40 hover:bg-white/70',
                  )}
                  aria-label={rt.t('carousel.go', { name: c.name })}
                  aria-current={i === active ? 'true' : undefined}
                  onclick={() => go(i, true)}
                >
                  {#if i === active}{#key `${active}-${run}-${running}`}<span
                        class={cn('absolute inset-0 rounded-full bg-white', running && 'nf-dot-fill')}
                        style:--nf-slide={`${SLIDE_MS}ms`}
                      ></span>{/key}{/if}
                </button>
              {/each}
            </div>
            {#if auto}<button
                type="button"
                class={roundBtn}
                aria-label={paused ? rt.t('carousel.play') : rt.t('carousel.pause')}
                onclick={() => ((paused = !paused), run++)}
                >{#if paused}<PlayIcon class="size-4" />{:else}<PauseIcon class="size-4" />{/if}</button
              >{/if}
          </div>
          <div class="flex gap-2">
            <button type="button" class={roundBtn} aria-label={rt.t('carousel.prev')} onclick={() => go(active - 1, true)}
              ><ChevronLeftIcon class="size-5" /></button
            >
            <button type="button" class={roundBtn} aria-label={rt.t('carousel.next')} onclick={() => go(active + 1, true)}
              ><ChevronRightIcon class="size-5" /></button
            >
          </div>
        </div>
      {/if}
    </div>
  </section>
{/if}
