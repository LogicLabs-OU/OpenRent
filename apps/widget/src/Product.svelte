<svelte:options
  customElement={{
    tag: 'openrent-product',
    shadow: 'open',
    props: { product: { type: 'String' }, shop: { type: 'String' }, pk: { type: 'String' }, api: { type: 'String' }, storefront: { type: 'String' }, lang: { type: 'String' }, checkout: { type: 'String' } },
  }}
/>

<script lang="ts">
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { call, config, money, openCheckout } from './api.ts';
  import { css, registerProperties, themeCss } from './styles.ts';
  import { t } from './i18n/index.ts';

  /** `checkout="storefront"` hands the booking to the storefront cart instead of the checkout drawer. */
  let { product = '', shop = '', pk = '', api = '', storefront = '', lang = '', checkout = 'inline' }: { product?: string; shop?: string; pk?: string; api?: string; storefront?: string; lang?: string; checkout?: string } = $props();
  registerProperties();
  const cfg = $derived(config({ api, shop, pk, storefront, lang }));
  // The shop's theme look (FR-THM-10), after the widget's own styles.
  let themeStyle = $state('');
  $effect(() => {
    if (cfg.api) void themeCss(cfg).then((c) => (themeStyle = c));
  });
  let host: HTMLElement | undefined = $state();
  let p = $state<any>(null);
  let from = $state('');
  let to = $state('');
  let qty = $state(1);
  let quote = $state<any>(null);
  let error = $state('');
  let busy = $state(false);
  const variant = $derived(p?.variants?.[0]);

  $effect(() => {
    if (!product || !cfg.api) return;
    call(cfg, `/catalog/products/${encodeURIComponent(product)}?locale=${cfg.locale}`).then((r) => (p = r), (e) => (error = e.message));
  });

  $effect(() => {
    quote = null;
    error = '';
    if (!variant || !from || !to) return;
    const s = new Date(from).toISOString();
    const e = new Date(to).toISOString();
    if (e <= s) return;
    call(cfg, '/price_quote', { starts_at: s, ends_at: e, lines: [{ variant_id: variant.id, quantity: qty }], locale: cfg.locale }).then((q) => (quote = q), (err) => (error = err.message));
  });

  function emit(name: string, detail: unknown) {
    host?.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  async function book() {
    busy = true;
    try {
      if (checkout !== 'storefront') {
        await openCheckout({ product: p.slug, shop, pk, api: cfg.api, storefront: cfg.storefront, lang: cfg.locale, from: new Date(from).toISOString(), to: new Date(to).toISOString(), qty });
        return;
      }
      const s = await call(cfg, '/checkout_sessions', { starts_at: new Date(from).toISOString(), ends_at: new Date(to).toISOString(), lines: [{ variant_id: variant.id, quantity: qty }] });
      emit('openrent:add-to-cart', { product: p.slug, variant_id: variant.id, quantity: qty, checkout_session: s.id });
      location.href = `${cfg.storefront!.replace(/\/$/, '')}/cart?session=${encodeURIComponent(s.id)}`;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

{@html css}{@html themeStyle}
<div class="bg-card text-card-foreground ring-foreground/10 flex w-full max-w-md flex-col gap-4 rounded-xl p-5 text-sm shadow-xs ring-1" bind:this={host} part="container">
  {#if p}
    <div class="flex flex-col gap-1">
      <div class="text-base font-semibold" part="title">{p.name}</div>
      {#if variant?.price}<div class="text-muted-foreground">{variant.price.description}</div>{/if}
    </div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 [&_input]:min-w-0">
      <Field.Field>
        <Field.Label for="w-from">{t('pickup', {}, cfg.locale)}</Field.Label>
        <Input id="w-from" type="datetime-local" bind:value={from} />
      </Field.Field>
      <Field.Field>
        <Field.Label for="w-to">{t('return', {}, cfg.locale)}</Field.Label>
        <Input id="w-to" type="datetime-local" bind:value={to} />
      </Field.Field>
      <Field.Field class="sm:col-span-2">
        <Field.Label for="w-qty">{t('quantity', {}, cfg.locale)}</Field.Label>
        <div><Input id="w-qty" type="number" min={1} class="w-24" bind:value={qty} /></div>
      </Field.Field>
    </div>
    {#if quote}
      <div class="bg-border h-px" role="separator"></div>
      <div class="flex items-baseline justify-between text-base"><span>{t('total', {}, cfg.locale)}</span><strong class="tabular-nums">{money(quote.total, cfg.locale)}</strong></div>
      {#if quote.deposit.amount}<div class="text-muted-foreground -mt-3">{t('deposit', { amount: money(quote.deposit, cfg.locale) }, cfg.locale)}</div>{/if}
    {/if}
    {#if error}<p class="text-destructive" role="alert">{error}</p>{/if}
    <Button part="button" size="lg" class="w-full" disabled={!quote || busy} onclick={book}>
      {#if busy}<Spinner />{/if}{t('book', {}, cfg.locale)}
    </Button>
  {:else if error}
    <p class="text-destructive" role="alert">{error}</p>
  {:else}
    <p class="text-muted-foreground flex items-center gap-2"><Spinner />{t('loading', {}, cfg.locale)}</p>
  {/if}
</div>
