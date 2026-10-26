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
  import Placeholder from '../snippets/Placeholder.svelte';
  import { btn, h1 } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

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
  const category = $derived(rt.shop.categories.find((c) => p.category_ids.includes(c.id)));
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

<div class="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
  <!-- min-w-0: a long row of photo thumbnails scrolls instead of widening the page. -->
  <div class="flex min-w-0 flex-col gap-4">
    <div class="aspect-[4/3] overflow-hidden rounded-[20px] bg-[var(--ln-beige)]">
      {#if p.images[photo]}<img
          class="size-full object-cover"
          src={p.images[photo]!.url}
          alt={p.images[photo]!.alt ?? p.name}
        />{:else}<Placeholder name={p.name} size="lg" />{/if}
    </div>
    {#if p.images.length > 1}
      <div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={rt.t('product.photos')}>
        {#each p.images as img, i (img.url)}
          <button
            type="button"
            class={[
              'size-18 shrink-0 overflow-hidden rounded-xl border-2 outline-none focus-visible:ring-3 focus-visible:ring-[var(--ln-accent)]/50',
              i === photo ? 'border-[#202020]' : 'border-transparent opacity-75 hover:opacity-100',
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
    {#if p.description_html || p.description || p.fields?.length || p.bundle || p.deposit_amount.amount}
      <div class="flex flex-col gap-6 rounded-[20px] bg-[var(--ln-panel)] p-6 md:p-10" use:reveal>
        <h2 class="ln-display flex items-baseline gap-3 text-2xl tracking-[-0.01em]">
          <span class="ln-square -translate-y-0.5" aria-hidden="true"></span>{rt.t('product.about')}
        </h2>
        {#if p.description_html}
          <div class="rich-text text-lg leading-[1.5] text-[#4d4d4d]">{@html p.description_html}</div>
        {:else if p.description}<p class="text-lg leading-[1.5] whitespace-pre-wrap text-[#4d4d4d]">
            {p.description}
          </p>{/if}
        {#if p.fields?.length}
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 text-sm" data-testid="product-fields">
            {#each p.fields as f (f.key)}<dt class="border-t border-[#202020]/10 py-2.5 text-[#666]">{f.label}</dt>
              <dd class="ln-mono border-t border-[#202020]/10 py-2.5">{f.display}</dd>{/each}
          </dl>
        {/if}
        {#if p.bundle}
          <div class="text-sm">
            <span class="font-medium">{rt.t('product.includes')}:</span>
            <span class="text-[#4d4d4d]">{p.bundle.components.map((c) => `${c.quantity} × ${c.name}`).join(', ')}</span>
          </div>
        {/if}
        {#if p.deposit_amount.amount}<p class="text-sm text-[#4d4d4d]">
            {rt.t('product.deposit', { amount: rt.format.money(p.deposit_amount) })}
          </p>{/if}
      </div>
    {/if}
  </div>

  <div class="flex h-fit flex-col gap-6 lg:sticky lg:top-28">
    <div class="flex flex-col gap-4">
      {#if category}<a
          class="flex w-fit items-center gap-2.5 text-[0.8125rem] font-medium text-[var(--ln-accent)] underline-offset-4 hover:underline"
          href={rt.url.category(category.slug)}><span class="ln-square size-2" aria-hidden="true"></span>{category.name}</a
        >{/if}
      <h1 class={h1}>{p.name}</h1>
      {#if variant?.price}<p class="ln-mono text-lg text-[var(--ln-accent)]">{variant.price.description}</p>{/if}
    </div>
    <Card.Root class="gap-5 py-6 md:py-8">
      <Card.Header class="md:px-8">
        <Card.Title class="ln-display text-2xl tracking-[-0.01em]">{rt.t('product.book')}</Card.Title>
        {#if !from || !to}<Card.Description>{rt.t('product.choose_dates')}</Card.Description>{/if}
      </Card.Header>
      <Card.Content class="md:px-8">
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
            <div class="flex items-center gap-3">
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
          <div class="mt-6 rounded-xl bg-[var(--ln-panel)] p-4 md:p-5"><PriceSummary {quote} /></div>
        {/if}
        {#if quoteError}
          <Alert.Root variant="destructive" class="mt-6"
            ><CircleAlertIcon /><Alert.Title>{quoteError}</Alert.Title></Alert.Root
          >
        {/if}
        <rt.components.Slot name="product.before_add" context={{ product: p }} />
      </Card.Content>
      <Card.Footer class="flex-col items-stretch gap-2 md:px-8">
        {#if added}
          <p class="flex items-center gap-2 text-sm font-medium" role="status">
            <CircleCheckIcon class="size-4 text-[var(--ln-accent)]" />{rt.t('product.added')}
          </p>
          <Button class={[btn, 'h-12']} href={rt.url.cart()}>{rt.t('cart.checkout')}</Button>
        {:else}
          <Button class={[btn, 'h-12']} disabled={!from || !to || busy || !enough} onclick={add}>
            {#if busy}<Spinner />{:else}<ShoppingCartIcon />{/if}{rt.t('product.add')}
          </Button>
        {/if}
      </Card.Footer>
    </Card.Root>
  </div>
</div>
