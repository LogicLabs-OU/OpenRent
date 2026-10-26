<script lang="ts">
  import { getRuntime, formatTime, type ProductData, type PriceQuote } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
  import { toast } from 'svelte-sonner';
  import Calendar from '../snippets/Calendar.svelte';
  import PriceSummary from '../snippets/PriceSummary.svelte';
  import { formatLocalDate } from '../lib/dates.ts';
  import Availability from '../snippets/Availability.svelte';
  import ProductArt from '../snippets/ProductArt.svelte';
  import { big, glass, label } from '../lib/nightfall.ts';

  /** A big dark media card with the photos, the details in glass below, and the booking panel beside them. */
  let { data }: { data: ProductData } = $props();
  const rt = getRuntime();
  const p = $derived(data.product);
  const category = $derived(rt.shop.categories.find((c) => p.category_ids.includes(c.id)));
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

<div class="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-8">
  <!-- min-w-0: a long row of photo thumbnails scrolls instead of widening the page. -->
  <div class="relative flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1">
    <div class="nf-glow nf-glow-warm top-1/4 left-1/2 h-2/3 w-[110%] -translate-x-1/2 opacity-50" aria-hidden="true"></div>
    <div
      class="relative aspect-[4/3] overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0a12] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
    >
      {#if p.images[photo]}<img
          class="size-full object-cover"
          src={p.images[photo]!.url}
          alt={p.images[photo]!.alt ?? p.name}
        />{:else}<ProductArt name={p.name} size="lg" />{/if}
    </div>
    {#if p.images.length > 1}
      <div class="relative flex gap-2 overflow-x-auto p-1" role="group" aria-label={rt.t('product.photos')}>
        {#each p.images as img, i (img.url)}
          <button
            type="button"
            class={[
              'size-16 shrink-0 overflow-hidden rounded-2xl border-2 transition-opacity outline-none focus-visible:ring-4 focus-visible:ring-ring/60',
              i === photo ? 'border-white' : 'border-white/10 opacity-70 hover:opacity-100',
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
  </div>

  <div class="flex h-fit flex-col gap-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
    <div class="flex flex-col gap-3">
      {#if category}<a class={[label, 'w-fit hover:underline']} href={rt.url.category(category.slug)}>{category.name}</a
        >{/if}
      <h1 class="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance md:text-5xl">{p.name}</h1>
      {#if variant?.price}<p class="text-lg text-white/70">{variant.price.description}</p>{/if}
    </div>
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-xl font-semibold tracking-[-0.02em]">{rt.t('product.book')}</Card.Title>
        {#if !from || !to}<Card.Description>{rt.t('product.choose_dates')}</Card.Description>{/if}
      </Card.Header>
      <Card.Content>
        <Field.Group>
          {#if p.variants.length > 1}
            <Field.Field>
              <Field.Label for="or-variant">{rt.t('product.option')}</Field.Label>
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
          {#key variantId}<Calendar {variantId} bind:from={fromDate} bind:to={toDate} />{/key}
          <div class="grid grid-cols-2 gap-3">
            <Field.Field>
              <Field.Label for="or-p-from"
                >{rt.t('dates.pickup')}{fromDate
                  ? ` · ${formatLocalDate(fromDate, rt.shop.locale)}`
                  : ''}</Field.Label
              >
              <NativeSelect id="or-p-from" class="w-full" bind:value={fromTime} disabled={!fromOpts.length}>
                {#each fromOpts as time (time)}<NativeSelectOption value={time}
                    >{formatTime(time, rt.shop.locale)}</NativeSelectOption
                  >{:else}<NativeSelectOption value="">--:--</NativeSelectOption>{/each}
              </NativeSelect>
            </Field.Field>
            <Field.Field>
              <Field.Label for="or-p-to"
                >{rt.t('dates.return')}{toDate
                  ? ` · ${formatLocalDate(toDate, rt.shop.locale)}`
                  : ''}</Field.Label
              >
              <NativeSelect id="or-p-to" class="w-full" bind:value={toTime} disabled={!toOpts.length}>
                {#each toOpts as time (time)}<NativeSelectOption value={time}
                    >{formatTime(time, rt.shop.locale)}</NativeSelectOption
                  >{:else}<NativeSelectOption value="">--:--</NativeSelectOption>{/each}
              </NativeSelect>
            </Field.Field>
            {#if closedDay}<Field.Error class="col-span-2">{rt.t('dates.closed')}</Field.Error>{/if}
          </div>
          <Field.Field>
            <Field.Label for="or-qty">{rt.t('product.quantity')}</Field.Label>
            <div class="flex flex-wrap items-center gap-3">
              <Input
                id="or-qty"
                type="number"
                min={1}
                max={known ? (variant!.available as number) : undefined}
                class="w-24"
                bind:value={qty}
                aria-invalid={!enough}
              />
              {#if known && enough}<Availability count={variant!.available as number} />{/if}
            </div>
            {#if known && !enough}<Field.Error>{rt.t('product.unavailable')}</Field.Error>{/if}
          </Field.Field>
        </Field.Group>
        {#if quote}
          <div class="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4"><PriceSummary {quote} /></div>
        {/if}
        {#if quoteError}
          <Alert.Root variant="destructive" class="mt-6"
            ><CircleAlertIcon /><Alert.Title>{quoteError}</Alert.Title></Alert.Root
          >
        {/if}
        <rt.components.Slot name="product.before_add" context={{ product: p }} />
      </Card.Content>
      <Card.Footer class="flex-col items-stretch gap-3">
        {#if added}
          <p class="flex items-center gap-2 text-sm font-medium text-emerald-200" role="status">
            <CircleCheckIcon class="size-4" />{rt.t('product.added')}
          </p>
          <Button class={big} href={rt.url.cart()}>{rt.t('cart.checkout')}</Button>
        {:else}
          <Button class={big} disabled={!from || !to || busy || !enough} onclick={add}>
            {#if busy}<Spinner />{:else}<ShoppingCartIcon />{/if}{rt.t('product.add')}
          </Button>
        {/if}
      </Card.Footer>
    </Card.Root>
  </div>

  {#if p.description_html || p.description || p.fields?.length || p.bundle || p.deposit_amount.amount}
    <div class={[glass, 'flex flex-col gap-6 self-start p-6 md:p-8 lg:col-start-1 lg:row-start-2']}>
      {#if p.description_html}
        <div class="nf-prose text-base leading-[1.7] text-white/75 md:text-lg">{@html p.description_html}</div>
      {:else if p.description}<p class="text-base leading-[1.7] whitespace-pre-wrap text-white/75 md:text-lg">
          {p.description}
        </p>{/if}
      {#if p.fields?.length}
        <dl
          class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 border-t border-white/10 pt-6 text-sm"
          data-testid="product-fields"
        >
          {#each p.fields as f (f.key)}<dt class="text-white/55">{f.label}</dt>
            <dd class="font-medium">{f.display}</dd>{/each}
        </dl>
      {/if}
      {#if p.bundle}
        <div class="text-sm">
          <span class="font-semibold">{rt.t('product.includes')}:</span>
          <span class="text-white/70">{p.bundle.components.map((c) => `${c.quantity} × ${c.name}`).join(', ')}</span>
        </div>
      {/if}
      {#if p.deposit_amount.amount}<p class="text-sm text-white/70">
          {rt.t('product.deposit', { amount: rt.format.money(p.deposit_amount) })}
        </p>{/if}
    </div>
  {/if}
</div>
