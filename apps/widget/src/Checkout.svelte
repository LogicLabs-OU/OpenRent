<svelte:options
  customElement={{
    tag: 'openrent-checkout',
    shadow: 'open',
    props: {
      product: { type: 'String' }, shop: { type: 'String' }, pk: { type: 'String' }, api: { type: 'String' }, storefront: { type: 'String' }, lang: { type: 'String' },
      from: { type: 'String' }, to: { type: 'String' }, qty: { type: 'Number' }, order: { type: 'String' }, token: { type: 'String' }, paid: { type: 'String' },
    },
  }}
/>

<script lang="ts">
  import { onMount } from 'svelte';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Spinner } from '@openrent/ui/spinner';
  import XIcon from '@lucide/svelte/icons/x';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import { call, config, money } from './api.ts';
  import { css, registerProperties } from './styles.ts';
  import { t } from './i18n/index.ts';

  /**
   * The booking drawer (FR-SF-2): dates, contact details and terms, then the order. With online payment
   * the customer pays on the provider's page and comes back to this page (`order`/`token`/`paid`).
   */
  let { product = '', shop = '', pk = '', api = '', storefront = '', lang = '', from = '', to = '', qty = 1, order = '', token = '', paid = '' }: Record<string, any> = $props();
  registerProperties();
  const cfg = $derived(config({ api, shop, pk, storefront, lang }));
  const L = $derived(cfg.locale);

  let host: HTMLElement | undefined = $state();
  let p = $state<any>(null);
  let settings = $state<any>(null);
  let starts = $state(toLocal(from));
  let ends = $state(toLocal(to));
  let quantity = $state(Number(qty) || 1);
  let quote = $state<any>(null);
  let customer = $state({ name: '', email: '', phone: '' });
  let accepted = $state(false);
  let errors = $state<Record<string, string>>({});
  let dateError = $state('');
  let message = $state('');
  let busy = $state(false);
  let done = $state<any>(null);
  const variant = $derived(p?.variants?.[0]);

  function toLocal(iso: string) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  onMount(() => {
    if (order && token) {
      call(cfg, `/orders/${encodeURIComponent(order)}?token=${encodeURIComponent(token)}`).then((o) => (done = { order: o, paid: paid === '1' }), (e) => (message = e.message));
    } else {
      call(cfg, `/catalog/products/${encodeURIComponent(product)}?locale=${L}`).then((r) => (p = r), (e) => (message = e.message));
      call(cfg, `/settings?locale=${L}`).then((s) => (settings = s), (e) => (message = e.message));
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  $effect(() => {
    quote = null;
    dateError = '';
    if (!variant || !starts || !ends) return;
    const s = new Date(starts).toISOString();
    const e = new Date(ends).toISOString();
    if (e <= s) return;
    call(cfg, '/price_quote', { starts_at: s, ends_at: e, lines: [{ variant_id: variant.id, quantity }], locale: L }).then(
      (q) => (quote = q),
      (err) => (dateError = err.message),
    );
  });

  function close() {
    // A finished booking leaves the order out of the address bar, so a reload does not show it again.
    if (done && typeof history !== 'undefined') {
      const u = new URL(location.href);
      for (const k of ['openrent_order', 'openrent_token', 'openrent_paid']) u.searchParams.delete(k);
      history.replaceState(history.state, '', u);
    }
    ((host?.getRootNode() as ShadowRoot | undefined)?.host as HTMLElement | undefined)?.remove();
  }

  /** Where to come back after paying: this page without earlier booking parameters. */
  function returnUrl() {
    const u = new URL(location.href);
    for (const k of ['openrent_order', 'openrent_token', 'openrent_paid']) u.searchParams.delete(k);
    return u.toString();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    message = '';
    try {
      const session = await call(cfg, '/checkout_sessions', { starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(), lines: [{ variant_id: variant.id, quantity }] });
      const r = await call(cfg, `/checkout_sessions/${session.id}/actions/complete`, {
        customer: { name: customer.name, email: customer.email, ...(customer.phone ? { phone: customer.phone } : {}), locale: L },
        terms_accepted: accepted,
        terms_hash: settings.terms.hash,
        return_url: returnUrl(),
      });
      host?.dispatchEvent(new CustomEvent('openrent:booked', { detail: { order: r.order.id, number: r.order.number }, bubbles: true, composed: true }));
      if (r.payment?.url) {
        location.href = r.payment.url;
        return;
      }
      done = { order: { ...r.order, public_token: r.order.token }, paid: false };
    } catch (err: any) {
      const shown = new Set(['starts_at', 'customer.name', 'customer.email', 'terms_accepted', 'return_url']);
      for (const f of err.fields ?? []) errors[f.field] = f.message;
      // Problems the form has no place for (return outside opening hours, stock) show above the button.
      const other = (err.fields ?? []).filter((f: { field: string }) => !shown.has(f.field)).map((f: { message: string }) => f.message);
      if (!err.fields?.length || other.length) message = other.length ? [...new Set(other)].join(' ') : err.message;
    } finally {
      busy = false;
    }
  }

  const orderLink = $derived(done ? `${cfg.storefront!.replace(/\/$/, '')}/order/${done.order.public_token ?? token}` : '');
</script>

{@html css}
<div class="fixed inset-0 z-[2147483000] flex justify-end bg-black/40 text-sm" part="backdrop" onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
  <div bind:this={host} class="bg-background text-foreground flex h-full w-full max-w-md flex-col overflow-y-auto shadow-xl" role="dialog" aria-modal="true" aria-label={t('checkout_title', {}, L)} part="drawer">
    <div class="flex items-center justify-between border-b px-5 py-4">
      <span class="text-base font-semibold">{done ? t('booked_title', {}, L) : (p?.name ?? t('checkout_title', {}, L))}</span>
      <Button variant="ghost" size="icon" onclick={close} aria-label={t('close', {}, L)}><XIcon /></Button>
    </div>
    <div class="flex flex-col gap-5 p-5">
      {#if done}
        <div class="flex flex-col items-center gap-3 py-6 text-center" data-testid="checkout-done">
          <CircleCheckIcon class="size-10 text-emerald-600" />
          <p class="text-base font-medium">{t('booked_number', { number: done.order.number }, L)}</p>
          <p class="text-muted-foreground">{done.paid ? t('booked_paid', {}, L) : t('booked_email', {}, L)}</p>
          <Button href={orderLink} target="_blank" rel="noopener">{t('view_booking', {}, L)}</Button>
        </div>
      {:else if p && settings}
        <form class="flex flex-col gap-5" onsubmit={submit} novalidate>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 [&_input]:min-w-0">
            <Field.Field>
              <Field.Label for="c-from">{t('pickup', {}, L)}</Field.Label>
              <Input id="c-from" type="datetime-local" bind:value={starts} required />
            </Field.Field>
            <Field.Field>
              <Field.Label for="c-to">{t('return', {}, L)}</Field.Label>
              <Input id="c-to" type="datetime-local" bind:value={ends} required />
            </Field.Field>
            <Field.Field class="sm:col-span-2">
              <Field.Label for="c-qty">{t('quantity', {}, L)}</Field.Label>
              <div><Input id="c-qty" type="number" min={1} class="w-24" bind:value={quantity} /></div>
            </Field.Field>
          </div>
          {#if dateError || errors.starts_at}<p class="text-destructive" role="alert">{dateError || errors.starts_at}</p>{/if}
          {#if quote}
            <div class="flex items-baseline justify-between border-y py-3 text-base"><span>{t('total', {}, L)}</span><strong class="tabular-nums" data-testid="checkout-total">{money(quote.total, L)}</strong></div>
          {/if}
          <Field.Group>
            <Field.Field data-invalid={!!errors['customer.name'] || undefined}>
              <Field.Label for="c-name">{t('name', {}, L)}</Field.Label>
              <Input id="c-name" autocomplete="name" bind:value={customer.name} required aria-invalid={!!errors['customer.name']} />
              {#if errors['customer.name']}<Field.Error>{errors['customer.name']}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors['customer.email'] || undefined}>
              <Field.Label for="c-email">{t('email', {}, L)}</Field.Label>
              <Input id="c-email" type="email" autocomplete="email" bind:value={customer.email} required aria-invalid={!!errors['customer.email']} />
              {#if errors['customer.email']}<Field.Error>{errors['customer.email']}</Field.Error>{/if}
            </Field.Field>
            <Field.Field>
              <Field.Label for="c-phone">{t('phone', {}, L)}</Field.Label>
              <Input id="c-phone" type="tel" autocomplete="tel" bind:value={customer.phone} />
            </Field.Field>
            <details class="text-muted-foreground rounded-md border p-3 text-xs">
              <summary class="cursor-pointer">{t('terms', {}, L)}</summary>
              <p class="mt-2 whitespace-pre-line">{settings.terms.text}</p>
            </details>
            <Field.Field orientation="horizontal" data-invalid={!!errors.terms_accepted || undefined}>
              <Checkbox id="c-terms" bind:checked={accepted} aria-invalid={!!errors.terms_accepted} />
              <Field.Label for="c-terms" class="font-normal">{t('accept_terms', {}, L)}</Field.Label>
            </Field.Field>
            {#if errors.terms_accepted}<Field.Error>{errors.terms_accepted}</Field.Error>{/if}
          </Field.Group>
          {#if message || errors.return_url}<p class="text-destructive" role="alert">{message || errors.return_url}</p>{/if}
          <Button type="submit" size="lg" class="w-full" disabled={busy || !quote}>
            {#if busy}<Spinner />{/if}{settings.payment ? t('book_and_pay', {}, L) : t('book', {}, L)}
          </Button>
        </form>
      {:else if message}
        <p class="text-destructive" role="alert">{message}</p>
      {:else}
        <p class="text-muted-foreground flex items-center gap-2"><Spinner />{t('loading', {}, L)}</p>
      {/if}
    </div>
  </div>
</div>
