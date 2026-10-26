<script lang="ts">
  import { getRuntime, formatTime, type ProductData, type PriceQuote } from '@openrent/theme-sdk';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import { toast } from 'svelte-sonner';
  import Calendar from '../snippets/Calendar.svelte';
  import PriceSummary from '../snippets/PriceSummary.svelte';
  import { formatLocalDate } from '../lib/dates.ts';
  import Availability from '../snippets/Availability.svelte';
  import Poster from '../snippets/Poster.svelte';
  import { box, categoryOf, cta, h1, label, pad } from '../lib/marquee.ts';

  let { data }: { data: ProductData } = $props();
  const rt = getRuntime();
  const p = $derived(data.product);
  // svelte-ignore state_referenced_locally
  let variantId = $state(data.product.variants[0]?.id ?? '');
  let qty = $state(1);
  let photo = $state(0);
  let fromDate = $state(rt.shop.dates.from ? rt.zone.localDate(rt.shop.dates.from) : '');
  let toDate = $state(rt.shop.dates.to ? rt.zone.localDate(rt.shop.dates.to) : '');
  let fromTime = $state(rt.shop.dates.from ? rt.zone.localTime(rt.shop.dates.from) : '');
  let toTime = $state(rt.shop.dates.to ? rt.zone.localTime(rt.shop.dates.to) : '');
  let quote = $state<PriceQuote | null>(null);
  let quoteError = $state('');
  let added = $state(false);
  let busy = $state(false);

  const variant = $derived(p.variants.find((v) => v.id === variantId));
  const fromOpts = $derived(fromDate ? rt.zone.timeOptions(fromDate) : []);
  const toOpts = $derived(toDate ? rt.zone.timeOptions(toDate) : []);
  $effect(() => {
    if (fromOpts.length && !fromOpts.includes(fromTime)) fromTime = fromOpts[0]!;
    if (toOpts.length && !toOpts.includes(toTime)) toTime = toOpts[toOpts.length - 1]!;
  });
  const from = $derived(fromDate && fromTime && fromOpts.length ? rt.zone.toInstant(fromDate, fromTime) : '');
  const to = $derived(toDate && toTime && toOpts.length ? rt.zone.toInstant(toDate, toTime) : '');
  const closedDay = $derived((fromDate && !fromOpts.length) || (toDate && !toOpts.length));
  const known = $derived(variant?.available !== undefined && variant.available !== null);
  const enough = $derived(!known || (variant!.available as number) >= qty);
  const category = $derived(rt.shop.categories.find((c) => p.category_ids.includes(c.id)));
  /** Numbered booking steps; the option step only shows when there is a choice. */
  const step = (n: 'option' | 'dates' | 'times' | 'qty') =>
    pad(['option', 'dates', 'times', 'qty'].filter((x) => x !== 'option' || p.variants.length > 1).indexOf(n) + 1);

  $effect(() => {
    const f = from;
    const t = to;
    const v = variantId;
    const q = qty;
    quote = null;
    quoteError = '';
    if (!f || !t || new Date(t) <= new Date(f) || q < 1) return;
    rt.quote([{ variant_id: v, quantity: q }], f, t).then(
      (r) => (quote = r),
      (e: Error) => (quoteError = e.message),
    );
  });

  async function add() {
    busy = true;
    try {
      if (from && to && (from !== rt.shop.dates.from || to !== rt.shop.dates.to)) await rt.setDates(from, to);
      await rt.addToCart(variantId, qty);
      added = true;
      toast.success(rt.t('product.added'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<a class="mq-mono mb-6 flex w-fit items-center gap-2 text-xs uppercase hover:text-(--mq-accent)" href={category ? rt.url.category(category.slug) : rt.url.home()}
  ><ArrowLeftIcon class="size-3.5" aria-hidden="true" />{category?.name ?? rt.t('nav.all')}</a
>
<div class="mb-8 flex flex-col gap-4 border-b border-(--mq-ink) pb-6 md:mb-10 md:flex-row md:items-end md:justify-between md:gap-10">
  <h1 class={[h1, 'min-w-0 break-words md:text-[clamp(3rem,7.5vw,7.5rem)]']}>{p.name}</h1>
  {#if variant?.price}<p class="mq-mono shrink-0 pb-1 text-sm uppercase md:max-w-[45%] md:text-right md:text-lg">
      {variant.price.description}
    </p>{/if}
</div>

<div class="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
  <!-- min-w-0: a long row of photo thumbnails scrolls instead of widening the page. -->
  <div class="flex min-w-0 flex-col gap-6">
    <div class="mq-crop relative border border-(--mq-ink) bg-white p-2 md:p-3">
      <div class="aspect-[4/3] overflow-hidden">
        {#if p.images[photo]}<img
            class="size-full object-cover"
            src={p.images[photo]!.url}
            alt={p.images[photo]!.alt ?? p.name}
          />{:else}<Poster name={p.name} tag={categoryOf(rt, p)} big />{/if}
      </div>
    </div>
    {#if p.images.length > 1}
      <div class="flex gap-2 overflow-x-auto p-1" role="group" aria-label={rt.t('product.photos')}>
        {#each p.images as img, i (img.url)}
          <button
            type="button"
            class={[
              'size-20 shrink-0 overflow-hidden border p-0.5',
              i === photo ? 'border-(--mq-accent) bg-(--mq-accent)' : 'border-(--mq-ink) opacity-80 hover:opacity-100',
            ]}
            aria-label={rt.t('product.show_photo', { n: i + 1 })}
            aria-pressed={i === photo}
            onclick={() => (photo = i)}
          >
            <img class="size-full object-cover" src={img.url_sm ?? img.url} alt={img.alt ?? ''} loading="lazy" />
          </button>
        {/each}
      </div>
    {/if}
    {#if p.description_html}
      <div class="rich-text max-w-2xl text-xl leading-snug">{@html p.description_html}</div>
    {:else if p.description}<p class="max-w-2xl text-xl leading-snug whitespace-pre-wrap">{p.description}</p>{/if}
    {#if p.fields?.length}
      <dl class="mq-cells grid grid-cols-[auto_1fr]" data-testid="product-fields">
        {#each p.fields as f (f.key)}<dt class={[label, 'px-4 py-3']}>{f.label}</dt>
          <dd class="px-4 py-3 text-lg">{f.display}</dd>{/each}
      </dl>
    {/if}
    {#if p.bundle}
      <div class="flex flex-col gap-2 border border-(--mq-ink) p-4">
        <span class={label}>{rt.t('product.includes')}</span>
        <span class="text-lg uppercase">{p.bundle.components.map((c) => `${c.quantity} × ${c.name}`).join(', ')}</span>
      </div>
    {/if}
    {#if p.deposit_amount.amount}<p class="mq-mono text-sm uppercase">
        {rt.t('product.deposit', { amount: rt.format.money(p.deposit_amount) })}
      </p>{/if}
  </div>

  <section class={[box, 'h-fit lg:sticky lg:top-[calc(var(--mq-head)+1rem)]']} aria-labelledby="or-book">
    <div class="flex items-center justify-between gap-4 bg-(--mq-ink) px-4 py-3 text-(--mq-paper) md:px-5">
      <h2 id="or-book" class="mq-tight text-[1.75rem] leading-none font-bold uppercase">{rt.t('product.book')}</h2>
      {#if !from || !to}<span class="text-right text-sm leading-tight font-semibold uppercase"
          >{rt.t('product.choose_dates')}</span
        >{/if}
    </div>
    <Field.Group class="gap-0">
      {#if p.variants.length > 1}
        <Field.Field class="gap-2 border-b border-(--mq-ink) p-4 md:p-5">
          <Field.Label for="or-variant"><span class="mq-mono font-normal" aria-hidden="true">{step('option')}</span>{rt.t('product.option')}</Field.Label>
          <NativeSelect id="or-variant" class="w-full" bind:value={variantId}>
            {#each p.variants as v (v.id)}
              <NativeSelectOption value={v.id}
                >{v.available !== undefined
                  ? rt.t('product.option_free', { name: v.name, count: v.available ?? '∞' })
                  : v.name}</NativeSelectOption
              >
            {/each}
          </NativeSelect>
        </Field.Field>
      {/if}
      <div class="flex flex-col gap-2 border-b border-(--mq-ink) p-4 md:p-5">
        <p class={[label, 'flex gap-2']}><span class="mq-mono font-normal" aria-hidden="true">{step('dates')}</span>{rt.t('product.dates')}</p>
        {#key variantId}<Calendar {variantId} bind:from={fromDate} bind:to={toDate} />{/key}
      </div>
      <div class="flex flex-col gap-3 border-b border-(--mq-ink) p-4 md:p-5">
        <p class={[label, 'flex gap-2']}><span class="mq-mono font-normal" aria-hidden="true">{step('times')}</span>{rt.t('product.times')}</p>
        <div class="grid grid-cols-2 gap-3">
          <Field.Field>
            <Field.Label for="or-p-from"
              >{rt.t('dates.pickup')}{fromDate ? ` · ${formatLocalDate(fromDate, rt.shop.locale)}` : ''}</Field.Label
            >
            <NativeSelect id="or-p-from" class="w-full" bind:value={fromTime} disabled={!fromOpts.length}>
              {#each fromOpts as time (time)}<NativeSelectOption value={time}
                  >{formatTime(time, rt.shop.locale)}</NativeSelectOption
                >{:else}<NativeSelectOption value="">--:--</NativeSelectOption>{/each}
            </NativeSelect>
          </Field.Field>
          <Field.Field>
            <Field.Label for="or-p-to"
              >{rt.t('dates.return')}{toDate ? ` · ${formatLocalDate(toDate, rt.shop.locale)}` : ''}</Field.Label
            >
            <NativeSelect id="or-p-to" class="w-full" bind:value={toTime} disabled={!toOpts.length}>
              {#each toOpts as time (time)}<NativeSelectOption value={time}
                  >{formatTime(time, rt.shop.locale)}</NativeSelectOption
                >{:else}<NativeSelectOption value="">--:--</NativeSelectOption>{/each}
            </NativeSelect>
          </Field.Field>
          {#if closedDay}<Field.Error class="col-span-2">{rt.t('dates.closed')}</Field.Error>{/if}
        </div>
      </div>
      <Field.Field class="gap-2 p-4 md:p-5">
        <Field.Label for="or-qty"><span class="mq-mono font-normal" aria-hidden="true">{step('qty')}</span>{rt.t('product.quantity')}</Field.Label>
        <div class="flex flex-wrap items-center gap-3">
          <Input
            id="or-qty"
            type="number"
            min={1}
            max={known ? (variant!.available as number) : undefined}
            class="mq-mono h-11 w-24 text-lg"
            bind:value={qty}
            aria-invalid={!enough}
          />
          {#if known && enough}<Availability count={variant!.available as number} />{/if}
        </div>
        {#if known && !enough}<Field.Error>{rt.t('product.unavailable')}</Field.Error>{/if}
      </Field.Field>
    </Field.Group>
    {#if quote}
      <div class="mq-perf mx-4 mt-2 mb-6 px-1 pt-5 md:mx-5"><PriceSummary {quote} /></div>
    {/if}
    {#if quoteError}
      <Alert.Root variant="destructive" class="mx-4 mb-4 w-auto md:mx-5"
        ><CircleAlertIcon /><Alert.Title>{quoteError}</Alert.Title></Alert.Root
      >
    {/if}
    <div class="px-4 md:px-5"><rt.components.Slot name="product.before_add" context={{ product: p }} /></div>
    <div class="flex flex-col gap-3 border-t border-(--mq-ink)">
      {#if added}
        <p class="flex items-center gap-2 px-4 pt-3 text-lg font-semibold uppercase md:px-5" role="status">
          <CircleCheckIcon class="size-5 text-(--mq-accent)" />{rt.t('product.added')}
        </p>
        <Button class={[cta, 'w-full justify-between']} href={rt.url.cart()}
          >{rt.t('cart.checkout')}<ArrowRightIcon class="mq-arrow" /></Button
        >
      {:else}
        <Button class={[cta, 'w-full justify-between']} disabled={!from || !to || busy || !enough} onclick={add}>
          {rt.t('product.add')}{#if busy}<Spinner />{:else}<ArrowRightIcon class="mq-arrow" />{/if}
        </Button>
      {/if}
    </div>
  </section>
</div>
