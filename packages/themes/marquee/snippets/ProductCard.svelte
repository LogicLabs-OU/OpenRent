<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import Availability from './Availability.svelte';
  import Poster from './Poster.svelte';
  import { categoryOf, priceFrom } from '../lib/marquee.ts';
  import { formatLocalDate } from '../lib/dates.ts';

  /**
   * An event poster: the photo (or a printed stand-in), a meta row with the category and the dates in mono,
   * the name in big condensed capitals, and "from €x" beside a boxed BOOK button in the bottom-right corner.
   */
  let { product }: { product: Product } = $props();
  const rt = getRuntime();
  const category = $derived(categoryOf(rt, product));
  const from = $derived(priceFrom(rt, product));
  const avail = $derived(
    product.variants.some((v) => v.available !== undefined)
      ? product.variants.reduce((a, v) => a + (v.available ?? 99), 0)
      : undefined,
  );
  const dates = $derived.by(() => {
    const { from: f, to: t } = rt.shop.dates;
    if (!f || !t) return '';
    const fmt = (iso: string) =>
      formatLocalDate(rt.zone.localDate(iso), rt.shop.locale, { day: 'numeric', month: 'short' });
    return `${fmt(f)} – ${fmt(t)}`;
  });
</script>

<a
  class="group flex h-full flex-col border border-(--mq-ink) bg-(--mq-paper) outline-offset-4"
  href={rt.url.product(product.slug)}
  data-testid="product-card"
>
  <div class="mq-media aspect-[4/3] overflow-hidden border-b border-(--mq-ink) sm:aspect-square">
    {#if product.images[0]}<img
        class="size-full object-cover"
        src={product.images[0].url_sm ?? product.images[0].url}
        alt={product.images[0].alt ?? ''}
        loading="lazy"
      />{:else}<Poster name={product.name} tag={category} />{/if}
  </div>
  <div class="flex flex-1 flex-col gap-2 px-4 pt-4 pb-5 md:px-5">
    <div class="flex items-start justify-between gap-3 text-[0.8125rem] leading-tight font-semibold uppercase">
      <span class="tracking-[0.03em]">{category}</span>
      {#if dates}<span class="mq-mono shrink-0 text-right text-[0.75rem]">{dates}</span>{/if}
    </div>
    <h3 class="mq-tight text-[1.875rem] leading-[0.92] font-bold break-words uppercase">{product.name}</h3>
    {#if product.bundle}<p class="text-muted-foreground text-sm uppercase">
        {product.bundle.components.map((c) => `${c.quantity}× ${c.name}`).join(' + ')}
      </p>{/if}
    {#if avail !== undefined}<div class="pt-1"><Availability count={avail} /></div>{/if}
  </div>
  <div class="mt-auto flex items-end justify-between gap-3">
    <span class="mq-mono pb-3 pl-4 text-[0.75rem] uppercase md:pl-5">{from}</span>
    <span
      class="mq-fill -mr-px -mb-px flex h-12 shrink-0 items-center gap-3 border border-(--mq-ink) px-4 text-[1.5rem] font-bold tracking-[-0.02em] uppercase"
      >{rt.t('card.book')}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></span
    >
  </div>
</a>
