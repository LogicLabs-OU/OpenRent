<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import DateBar from '../snippets/DateBar.svelte';
  import Poster from '../snippets/Poster.svelte';
  import { categoryOf, display, priceFrom } from '../lib/marquee.ts';

  /**
   * A programme cover: a giant title whose second line is outlined, a short uppercase intro and the date search;
   * on the right a featured product pinned up as a tilted poster with crop marks over a checkerboard patch.
   */
  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as { heading: string; text: string; product: string; image: string; alt: string },
  );
  const lines = $derived(
    String(s.heading ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const featured = $derived(
    products.find((p) => p.slug === s.product || p.id === s.product) ??
      products.find((p) => p.images.length) ??
      products[0],
  );
  const photo = $derived(s.image || featured?.images[0]?.url || '');
  const alt = $derived(s.image ? (s.alt ?? '') : (featured?.images[0]?.alt ?? featured?.name ?? ''));
</script>

<section
  class="mb-16 grid items-start gap-14 pt-4 md:mb-24 md:pt-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-16"
>
  <div class="flex min-w-0 flex-col gap-8 md:gap-10">
    <h1 class={[display, 'break-words']}>
      {#each lines as l, i (i)}<span class={['block', i % 2 === 1 && 'mq-outline']}>{l}</span>{/each}
    </h1>
    {#if s.text}<p class="max-w-xl text-lg leading-[1.2] font-semibold text-pretty uppercase md:text-xl">
        {s.text}
      </p>{/if}
    <DateBar variant="panel" />
  </div>
  {#if featured || photo}
    <div class="relative mx-auto w-full max-w-[34rem] px-3 pt-4 lg:mt-6">
      <div
        class="mq-checker absolute bottom-[18%] -left-1 h-[52%] w-[34%] -rotate-3 md:-left-6"
        aria-hidden="true"
      ></div>
      <a
        class="mq-poster group relative block border border-(--mq-ink) bg-white p-3 text-(--mq-ink) md:p-4"
        href={featured ? rt.url.product(featured.slug) : (rt.url.search?.() ?? rt.url.home())}
      >
        <span class="mq-crop absolute inset-0" aria-hidden="true"></span>
        <div class="mq-media aspect-[4/3.6] overflow-hidden">
          {#if photo}<img class="size-full object-cover" src={photo} {alt} />{:else if featured}<Poster
              name={featured.name}
              tag={categoryOf(rt, featured)}
              big
            />{/if}
        </div>
        <div class="flex flex-col gap-1 px-1 pt-4">
          <span class="mq-mono text-[0.6875rem] tracking-[0.06em] uppercase">{rt.t('hero.featured')}</span>
          <span class="mq-tight text-[clamp(2.5rem,5vw,4rem)] leading-[0.86] font-bold break-words uppercase"
            >{featured?.name ?? rt.shop.tenant.name}</span
          >
          {#if featured && priceFrom(rt, featured)}<span class="mq-mono mt-2 text-sm uppercase"
              >{priceFrom(rt, featured)}</span
            >{/if}
        </div>
        <span
          class="mq-fill mt-5 -mr-3 -mb-3 ml-auto flex h-12 w-[70%] items-center justify-between bg-(--mq-accent) px-5 text-xl font-bold tracking-[-0.01em] text-(--mq-on-accent) uppercase [--mq-fill:var(--mq-ink)] [--mq-fill-text:var(--mq-paper)] md:-mr-4 md:-mb-4"
          >{rt.t('hero.book')}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></span
        >
      </a>
    </div>
  {/if}
</section>
