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
  import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
  import { toast } from 'svelte-sonner';
  import Calendar from '../snippets/Calendar.svelte';
  import PriceSummary from '../snippets/PriceSummary.svelte';
  import PriceTag from '../snippets/PriceTag.svelte';
  import { select, solid, wrap } from '../lib/retro.ts';
  import { formatLocalDate } from '../lib/dates.ts';

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

<div class={[wrap, 'py-8 md:py-12']}>
  <article class="overflow-hidden rounded-[0.25rem] border border-black bg-white">
    <div
      class="flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-black bg-(--retro-accent) text-9xl text-(--retro-accent-ink) md:aspect-[21/9]"
    >
      {#if p.images[photo]}<img
          class="size-full object-cover"
          src={p.images[photo]!.url}
          alt={p.images[photo]!.alt ?? p.name}
        />{:else}<span aria-hidden="true">{p.name[0]}</span>{/if}
    </div>
    {#if p.images.length > 1}
      <div
        class="flex gap-3 overflow-x-auto border-b border-black p-4"
        role="group"
        aria-label={rt.t('product.photos')}
      >
        {#each p.images as img, i (img.url)}
          <button
            type="button"
            class={[
              'size-16 shrink-0 overflow-hidden rounded-[0.25rem] border border-black transition-[translate,box-shadow]',
              i === photo ? '-translate-0.5 shadow-[3px_3px_0_0_#000]' : 'opacity-70 hover:opacity-100',
            ]}
            aria-label={rt.t('product.show_photo', { n: i + 1 })}
            aria-pressed={i === photo}
            onclick={() => (photo = i)}
          >
            <img
              class="size-full object-cover"
              src={img.url_sm ?? img.url}
              alt={img.alt ?? ''}
              loading="lazy"
            />
          </button>
        {/each}
      </div>
    {/if}
    <div class="grid lg:grid-cols-[1fr_26rem]">
      <div class="flex flex-col border-b border-black lg:border-r lg:border-b-0">
        <h1
          class="border-b border-black p-6 text-4xl leading-tight font-normal tracking-tight md:p-8 md:text-5xl"
        >
          {p.name}
        </h1>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-black px-6 py-4 md:px-8">
          {#if variant?.price?.amount.amount}<PriceTag price={variant.price} size="lg" />{/if}
          {#if variant?.price}<span class="text-lg">{variant.price.description}</span>{/if}
          {#if p.deposit_amount.amount}<span class="text-muted-foreground"
              >{rt.t('product.deposit', { amount: rt.format.money(p.deposit_amount) })}</span
            >{/if}
        </div>
        <div class="flex flex-col gap-4 p-6 md:p-8">
          {#if p.description_html}
            <div class="rich-text text-lg leading-8">{@html p.description_html}</div>
          {:else if p.description}<p class="text-lg leading-8 whitespace-pre-wrap">{p.description}</p>{/if}
          {#if p.fields?.length}
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-2 border-black p-3 font-medium" data-testid="product-fields">
              {#each p.fields as f (f.key)}<dt class="opacity-70">{f.label}</dt><dd>{f.display}</dd>{/each}
            </dl>
          {/if}
          {#if p.bundle}
            <p>
              <span class="font-semibold">{rt.t('product.includes')}:</span>
              {p.bundle.components.map((c) => `${c.quantity} × ${c.name}`).join(', ')}
            </p>
          {/if}
        </div>
      </div>

      <section class="flex flex-col gap-6 p-6 md:p-8" aria-labelledby="or-book-title">
        <div class="flex flex-col gap-1">
          <h2 id="or-book-title" class="text-2xl tracking-tight">{rt.t('product.book')}</h2>
          {#if !from || !to}<p class="text-muted-foreground">{rt.t('product.choose_dates')}</p>{/if}
        </div>
        <Field.Group>
          {#if p.variants.length > 1}
            <Field.Field>
              <Field.Label for="or-variant" class="font-normal">{rt.t('product.option')}</Field.Label>
              <NativeSelect
                id="or-variant"
                class={['w-full [&_select]:h-11 [&_select]:text-base', select]}
                bind:value={variantId}
              >
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
          {#key variantId}<Calendar {variantId} bind:from={fromDate} bind:to={toDate} />{/key}
          <div class="grid grid-cols-2 gap-3">
            <Field.Field>
              <Field.Label for="or-p-from" class="font-normal"
                >{rt.t('dates.pickup')}{fromDate
                  ? ` · ${formatLocalDate(fromDate, rt.shop.locale)}`
                  : ''}</Field.Label
              >
              <NativeSelect
                id="or-p-from"
                class={['w-full [&_select]:h-11 [&_select]:text-base', select]}
                bind:value={fromTime}
                disabled={!fromOpts.length}
              >
                {#each fromOpts as time (time)}<NativeSelectOption value={time}>{formatTime(time, rt.shop.locale)}</NativeSelectOption
                  >{:else}<NativeSelectOption value="">--:--</NativeSelectOption>{/each}
              </NativeSelect>
            </Field.Field>
            <Field.Field>
              <Field.Label for="or-p-to" class="font-normal"
                >{rt.t('dates.return')}{toDate
                  ? ` · ${formatLocalDate(toDate, rt.shop.locale)}`
                  : ''}</Field.Label
              >
              <NativeSelect
                id="or-p-to"
                class={['w-full [&_select]:h-11 [&_select]:text-base', select]}
                bind:value={toTime}
                disabled={!toOpts.length}
              >
                {#each toOpts as time (time)}<NativeSelectOption value={time}>{formatTime(time, rt.shop.locale)}</NativeSelectOption
                  >{:else}<NativeSelectOption value="">--:--</NativeSelectOption>{/each}
              </NativeSelect>
            </Field.Field>
            {#if closedDay}<Field.Error class="col-span-2">{rt.t('dates.closed')}</Field.Error>{/if}
          </div>
          <Field.Field>
            <Field.Label for="or-qty" class="font-normal">{rt.t('product.quantity')}</Field.Label>
            <div class="flex items-center gap-3">
              <Input
                id="or-qty"
                type="number"
                min={1}
                max={known ? (variant!.available as number) : undefined}
                class="h-11 w-24 bg-white"
                bind:value={qty}
                aria-invalid={!enough}
              />
              {#if known && enough}<span class="flex items-center gap-1.5"
                  ><CircleCheckIcon class="size-4 text-[#23a094]" />{rt.t('product.available', {
                    count: variant!.available as number,
                  })}</span
                >{/if}
            </div>
            {#if known && !enough}<Field.Error>{rt.t('product.unavailable')}</Field.Error>{/if}
          </Field.Field>
        </Field.Group>
        {#if quote}
          <div class="rounded-[0.25rem] border border-black bg-(--background) p-4">
            <PriceSummary {quote} />
          </div>
        {/if}
        {#if quoteError}
          <Alert.Root variant="destructive" class="border-black"
            ><CircleAlertIcon /><Alert.Title>{quoteError}</Alert.Title></Alert.Root
          >
        {/if}
        <rt.components.Slot name="product.before_add" context={{ product: p }} />
        {#if added}
          <p class="flex items-center gap-2" role="status">
            <CircleCheckIcon class="size-5 text-[#23a094]" />{rt.t('product.added')}
          </p>
          <Button href={rt.url.cart()} class={[solid, 'w-full']}>{rt.t('cart.checkout')}</Button>
        {:else}
          <Button class={[solid, 'w-full']} disabled={!from || !to || busy || !enough} onclick={add}>
            {#if busy}<Spinner />{:else}<ShoppingBagIcon />{/if}{rt.t('product.add')}
          </Button>
        {/if}
      </section>
    </div>
  </article>
</div>
