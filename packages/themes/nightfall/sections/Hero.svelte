<script lang="ts" module>
  // The entrance plays when the page first loads, not again when the visitor comes back to the home page.
  let played = false;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { cn } from '@openrent/ui/utils';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import Accent from '../snippets/Accent.svelte';
  import DateBar from '../snippets/DateBar.svelte';
  import ProductArt from '../snippets/ProductArt.svelte';
  import { display, pill } from '../lib/nightfall.ts';

  /** A centred headline with one handwritten word, a huge rounded media card with its own caption, and the date search. */
  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as {
      heading: string;
      card_heading: string;
      card_text: string;
      image: string;
      alt: string;
      button_label: string;
      button_link: string;
    },
  );
  const enter = !played;
  onMount(() => (played = true));
  /** Products floating over the artwork when there is no photo. */
  const chips = $derived(products.filter((p) => p.variants.some((v) => v.price)).slice(0, 3));
  const per = (p: Product) => {
    const price = p.variants.find((v) => v.price)?.price;
    if (!price) return '';
    if (price.kind === 'fixed') return rt.format.money(price.amount);
    return rt.t('product.per', {
      price: rt.format.money(price.amount),
      unit: rt.t(`period.${price.period_unit}.one`),
    });
  };
  const CHIP_PLACES = [
    'top-[10%] right-[5%]',
    'top-[30%] left-[36%] hidden lg:flex',
    'top-[58%] right-[6%] hidden sm:flex',
  ];
</script>

<section class="relative mb-24 md:mb-32" data-section="hero">
  <div
    class="nf-glow nf-glow-warm -top-48 left-1/2 h-[640px] w-[min(1200px,140vw)] -translate-x-1/2 opacity-70"
    aria-hidden="true"
  ></div>
  <div class="relative flex flex-col items-center gap-10 md:gap-14">
    {#if s.heading}<h1 class={cn(display, 'max-w-5xl text-center', enter && 'nf-rise')}>
        <Accent text={s.heading} />
      </h1>{/if}
    <div
      class={cn(
        'relative w-full overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0a12] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]',
        enter && 'nf-rise',
      )}
      style:--nf-delay="120ms"
    >
      <div class={cn('aspect-[4/5] sm:aspect-[16/10] lg:aspect-[2/1]', enter && 'nf-settle')}>
        {#if s.image}<img class="size-full object-cover" src={s.image} alt={s.alt ?? ''} />{:else}
          <div class="nf-hero-art relative size-full" aria-hidden="true">
            <div
              class="nf-dots absolute inset-0 [mask-image:radial-gradient(70%_70%_at_70%_40%,black,transparent)]"
            ></div>
            <div
              class="absolute top-[30%] left-[62%] aspect-square w-[min(58%,560px)] sm:top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10"
            ></div>
            <div
              class="nf-orb absolute top-[30%] left-[62%] sm:top-1/2 aspect-square w-[min(30%,300px)] -translate-x-1/2 -translate-y-1/2 rounded-full"
            ></div>
            {#each chips as p, i (p.id)}
              <div
                class={cn(
                  'nf-float nf-glass absolute flex items-center gap-3 rounded-[20px] p-2 pr-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl',
                  CHIP_PLACES[i],
                )}
                style:--nf-delay={`${i * -2300}ms`}
              >
                <div class="size-12 overflow-hidden rounded-[14px]">
                  {#if p.images[0]}<img
                      class="size-full object-cover"
                      src={p.images[0].url_sm ?? p.images[0].url}
                      alt=""
                    />{:else}<ProductArt name={p.name} size="sm" />{/if}
                </div>
                <div class="flex flex-col">
                  <span class="text-sm font-semibold">{p.name}</span>
                  <span class="text-xs text-white/60">{per(p)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <div
        class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
        aria-hidden="true"
      ></div>
      <div class="absolute inset-x-0 bottom-0 flex max-w-2xl flex-col items-start gap-4 p-6 md:p-12 lg:pb-24">
        {#if s.card_heading}<h2
            class="text-2xl leading-tight font-semibold tracking-[-0.025em] text-balance md:text-4xl"
          >
            {s.card_heading}
          </h2>{/if}
        {#if s.card_text}<p class="text-[0.9375rem] leading-relaxed text-white/80 md:text-base">
            {s.card_text}
          </p>{/if}
        {#if s.button_label}<Button
            class={cn(pill, 'mt-1 h-11')}
            href={s.button_link || rt.url.search?.() || rt.url.home()}
            >{s.button_label}<ArrowRightIcon /></Button
          >{/if}
      </div>
    </div>
    <div
      class={cn('relative z-10 w-full lg:-mt-24 lg:w-[calc(100%-6rem)]', enter && 'nf-rise')}
      style:--nf-delay="220ms"
    >
      <DateBar variant="panel" />
    </div>
  </div>
</section>
