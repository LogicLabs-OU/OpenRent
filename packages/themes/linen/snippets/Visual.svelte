<script lang="ts" module>
  export type VisualKind = 'calendar' | 'prices' | 'booking' | 'categories';
</script>

<script lang="ts">
  import { getRuntime, weekStart, type Product } from '@openrent/theme-sdk';
  import InfoIcon from '@lucide/svelte/icons/info';

  /**
   * A small interface built from the shop's own data, shown on beige media panels instead of a screenshot:
   * a month of availability, a price list, a booking summary or the categories with their item counts.
   * It is an illustration, so assistive technology gets the caption only.
   */
  let { kind, products = [] }: { kind: VisualKind; products?: Product[] } = $props();
  const rt = getRuntime();
  const locale = $derived(rt.shop.locale);

  const now = new Date();
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, o).format(d);

  // Calendar: this month, a highlighted three-night stay starting in two days and a few booked days.
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const ws = $derived(weekStart(locale));
  const lead = $derived((first.getDay() - ws + 7) % 7);
  const weekdays = $derived(
    Array.from({ length: 7 }, (_, i) => fmt(new Date(2024, 0, 7 + ((i + ws) % 7)), { weekday: 'narrow' })),
  );
  const pick = day(2);
  const back = day(5);
  const inStay = (d: number) => {
    const t = new Date(now.getFullYear(), now.getMonth(), d).getTime();
    return t >= pick.getTime() && t <= back.getTime();
  };
  const booked = (d: number) => d > now.getDate() && !inStay(d) && (d * 7) % 11 < 2;

  const priced = $derived(products.filter((p) => p.variants.some((v) => v.price)).slice(0, 4));
  const cats = $derived(
    rt.shop.categories
      .map((c) => ({ name: c.name, count: products.filter((p) => p.category_ids.includes(c.id)).length }))
      .filter((c) => c.count)
      .slice(0, 6),
  );
  const box = 'w-full max-w-[26rem] rounded-2xl bg-white p-5 text-[#202020] shadow-[0_24px_60px_-34px_rgba(32,32,32,.4)] md:p-6';
</script>

<div class="flex w-full flex-col items-center gap-4" role="img" aria-label={rt.t('visual.caption')}>
  {#if kind === 'calendar'}
    <div class={box}>
      <div class="mb-4 flex items-center justify-between gap-3">
        <p class="font-medium capitalize">{fmt(now, { month: 'long', year: 'numeric' })}</p>
        <span class="inline-flex items-center gap-1.5 rounded-md bg-[#eaf6ee] px-2 py-0.5 text-xs text-[#1e6b3d]"
          ><span class="size-1.5 rounded-full bg-[#2f9e5b]"></span>{rt.t('visual.live')}</span
        >
      </div>
      <div class="ln-mono grid grid-cols-7 gap-1 text-center text-[0.75rem]">
        {#each weekdays as w, i (i)}<span class="pb-1 text-[#666]">{w}</span>{/each}
        {#each Array.from({ length: lead }) as _, i (i)}<span></span>{/each}
        {#each Array.from({ length: days }, (_, i) => i + 1) as d (d)}
          {@const stay = inStay(d)}
          <span
            class={[
              'relative grid h-9 place-items-center rounded-md',
              d < now.getDate() && 'text-[#202020]/65 line-through',
              stay && 'bg-[#f1ebdf]',
              (d === pick.getDate() || d === back.getDate()) && stay && 'bg-[var(--ln-accent)] text-white',
            ]}
            >{d}{#if booked(d)}<span class="absolute bottom-1 size-1 rounded-full bg-[var(--ln-signal)]"></span>{/if}</span
          >
        {/each}
      </div>
      <div class="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#202020]/8 pt-3 text-xs text-[#666]">
        <span class="flex items-center gap-1.5"><span class="size-2 rounded-sm bg-[var(--ln-accent)]"></span>{rt.t('visual.your_dates')}</span>
        <span class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-[var(--ln-signal)]"></span>{rt.t('visual.booked')}</span>
      </div>
    </div>
  {:else if kind === 'prices'}
    <div class={box}>
      <div class="mb-4 flex items-center justify-between gap-3">
        <p class="font-medium">{rt.t('visual.prices')}</p>
        <span class="ln-mono text-xs text-[#666]">{rt.t('hero.items', { count: products.length })}</span>
      </div>
      <ul class="flex flex-col gap-2">
        {#each priced as p, i (p.id)}
          {@const price = p.variants.find((v) => v.price)?.price}
          <li class={['flex flex-col gap-1 rounded-xl border px-4 py-3', i === 0 ? 'border-[var(--ln-signal)]/40 bg-[#fff4ee]' : 'border-[#202020]/8']}>
            <span class="flex items-center justify-between gap-3 text-sm font-medium"
              >{p.name}{#if i === 0}<span class="rounded-full bg-white px-2 py-0.5 text-[0.6875rem] text-[#a3401a]">{rt.t('visual.popular')}</span>{/if}</span
            >
            <span class="ln-mono line-clamp-1 text-xs text-[var(--ln-accent)]">{price?.description}</span>
          </li>
        {:else}
          <li class="text-sm text-[#666]">{rt.t('collection.empty')}</li>
        {/each}
      </ul>
    </div>
  {:else if kind === 'booking'}
    <div class={box}>
      <div class="mb-5 flex items-center justify-between gap-3">
        <p class="font-medium">{rt.t('visual.booking')}</p>
        <span class="rounded-full bg-[#eaf6ee] px-2.5 py-0.5 text-xs text-[#1e6b3d]">{rt.t('status.reserved')}</span>
      </div>
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-[#666]">{rt.t('dates.pickup')}</span>
          <span class="ln-mono text-sm">{fmt(pick, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </div>
        <span class="flex items-center gap-1" aria-hidden="true"
          ><span class="size-1.5 rounded-full bg-[var(--ln-signal)]"></span><span class="h-px w-10 bg-[#202020]/20"></span><span
            class="size-1.5 rounded-full border border-[#202020]/40"
          ></span></span
        >
        <div class="flex flex-col items-end gap-0.5">
          <span class="text-xs text-[#666]">{rt.t('dates.return')}</span>
          <span class="ln-mono text-sm">{fmt(back, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </div>
      </div>
      <ul class="mt-5 flex flex-col gap-2 border-t border-[#202020]/8 pt-4">
        {#each products.slice(0, 3) as p, i (p.id)}
          <li class="flex items-center justify-between gap-3 text-sm">
            <span class="flex items-center gap-2.5"><span class="ln-mono text-xs text-[#666]">{i + 1}×</span>{p.name}</span>
            <svg class="size-4 text-[var(--ln-accent)]" viewBox="0 0 24 24" fill="none"
              ><circle cx="12" cy="12" r="10.5" stroke="currentColor" stroke-width="1.5" /><path
                d="m8 12.2 2.7 2.7L16 9.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              /></svg
            >
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <div class={box}>
      <p class="mb-4 font-medium">{rt.t('visual.categories')}</p>
      <ul class="flex flex-col">
        {#each cats as c, i (i)}
          <li class="flex items-center justify-between gap-3 border-b border-[#202020]/8 py-2.5 text-sm last:border-0">
            <span class="flex items-center gap-2.5"><span class="ln-square size-2"></span>{c.name}</span>
            <span class="ln-mono text-xs text-[#666]">{c.count}</span>
          </li>
        {:else}
          <li class="text-sm text-[#666]">{rt.t('collection.empty')}</li>
        {/each}
      </ul>
    </div>
  {/if}
  <p class="flex items-center gap-1.5 text-center text-xs text-[#5e5e5e]">
    <InfoIcon class="size-3.5 shrink-0" aria-hidden="true" />{rt.t('visual.caption')}
  </p>
</div>
