<script lang="ts">
  import { getRuntime, RuntimeError, type CheckoutData } from '@openrent/theme-sdk';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Button } from '@openrent/ui/button';
  import { ScrollArea } from '@openrent/ui/scroll-area';
  import { Spinner } from '@openrent/ui/spinner';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { toast } from 'svelte-sonner';
  import PriceSummary from '../snippets/PriceSummary.svelte';
  import OptionalFees from '../snippets/OptionalFees.svelte';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { box, boxHead, cta, h1, pad } from '../lib/marquee.ts';

  let { data }: { data: CheckoutData } = $props();
  const rt = getRuntime();
  const cart = $derived(data.cart);
  let customer = $state({ name: '', email: '', phone: '', company_name: '', tax_id: '' });
  let address = $state({ line1: '', postal_code: '', city: '', country: '' });
  const withAddress = $derived(rt.shop.settings.checkout_fields === 'address');
  let notes = $state('');
  let terms = $state(false);
  let busy = $state(false);
  let errors = $state<Record<string, string>>({});
  let paymentError = $state('');
  const hasFees = $derived(!!(cart.quote?.optional_fees?.length && rt.setOptions));
  let payment = $state<{ clientSecret: string; publishableKey: string; returnUrl: string } | null>(null);

  async function place(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      const billing =
        withAddress && address.line1.trim()
          ? { ...address, country: address.country.trim().toUpperCase() || undefined }
          : undefined;
      const r = await rt.checkout({
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone || undefined,
          company_name: (withAddress && customer.company_name) || undefined,
          tax_id: (withAddress && customer.tax_id) || undefined,
          billing_address: billing,
        },
        terms_accepted: terms,
        notes: notes || undefined,
      });
      const returnUrl = new URL(rt.url.order(r.order.token), location.href).href;
      if (r.payment?.client_secret && r.payment.public_config.publishable_key) {
        payment = {
          clientSecret: r.payment.client_secret,
          publishableKey: r.payment.public_config.publishable_key,
          returnUrl,
        };
      } else location.href = returnUrl;
    } catch (err) {
      // Validation problems go next to their fields; anything else is a toast (error-handling §3).
      if (err instanceof RuntimeError && err.status === 422 && Object.keys(err.fields).length)
        errors = err.fields;
      else toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<div class="mb-8 flex items-end justify-between gap-6 border-b border-(--mq-ink) pb-5 md:mb-10">
  <h1 class={h1}>{rt.t('checkout.title')}</h1>
</div>
<div class="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-10">
  {#if payment}
    <section class={[box, 'h-fit']} aria-labelledby="or-pay">
      <h2 id="or-pay" class={boxHead}>{rt.t('checkout.payment')}</h2>
      <div class="flex flex-col gap-4 p-4 md:p-6">
        {#if paymentError}<Alert.Root variant="destructive"
            ><CircleAlertIcon /><Alert.Title>{paymentError}</Alert.Title></Alert.Root
          >{/if}
        <rt.components.Payment
          clientSecret={payment.clientSecret}
          publishableKey={payment.publishableKey}
          returnUrl={payment.returnUrl}
          onerror={(m) => (paymentError = m)}
        />
      </div>
    </section>
  {:else}
    <form class="flex min-w-0 flex-col gap-6" onsubmit={place} novalidate>
      <section class={box} aria-labelledby="or-contact">
        <h2 id="or-contact" class={boxHead}>
          <span class="mq-mono text-sm font-normal" aria-hidden="true">01</span>{rt.t('checkout.contact')}
        </h2>
        <div class="flex flex-col gap-6 p-4 md:p-6">
          <p class="text-muted-foreground text-lg leading-snug uppercase">{rt.t('checkout.contact_hint')}</p>
          <Field.Group>
            <Field.Field data-invalid={!!errors['customer.name'] || undefined}>
              <Field.Label for="or-name">{rt.t('checkout.name')}</Field.Label>
              <Input
                id="or-name"
                autocomplete="name"
                required
                bind:value={customer.name}
                aria-invalid={!!errors['customer.name']}
              />
              {#if errors['customer.name']}<Field.Error>{errors['customer.name']}</Field.Error>{/if}
            </Field.Field>
            <div class="grid gap-6 sm:grid-cols-2">
              <Field.Field data-invalid={!!errors['customer.email'] || undefined}>
                <Field.Label for="or-email">{rt.t('checkout.email')}</Field.Label>
                <Input
                  id="or-email"
                  type="email"
                  autocomplete="email"
                  required
                  bind:value={customer.email}
                  aria-invalid={!!errors['customer.email']}
                />
                {#if errors['customer.email']}<Field.Error>{errors['customer.email']}</Field.Error>{/if}
              </Field.Field>
              <Field.Field data-invalid={!!errors['customer.phone'] || undefined}>
                <Field.Label for="or-phone">{rt.t('checkout.phone')}</Field.Label>
                <Input
                  id="or-phone"
                  type="tel"
                  autocomplete="tel"
                  bind:value={customer.phone}
                  aria-invalid={!!errors['customer.phone']}
                />
                {#if errors['customer.phone']}<Field.Error>{errors['customer.phone']}</Field.Error>{/if}
              </Field.Field>
            </div>
            {#if withAddress}
              <div class="grid gap-6 sm:grid-cols-2">
                <Field.Field
                  ><Field.Label for="or-company">{rt.t('checkout.company')}</Field.Label><Input
                    id="or-company"
                    autocomplete="organization"
                    bind:value={customer.company_name}
                  /></Field.Field
                >
                <Field.Field data-invalid={!!errors['customer.tax_id'] || undefined}
                  ><Field.Label for="or-vat">{rt.t('checkout.tax_id')}</Field.Label><Input
                    id="or-vat"
                    bind:value={customer.tax_id}
                  />{#if errors['customer.tax_id']}<Field.Error>{errors['customer.tax_id']}</Field.Error
                    >{/if}</Field.Field
                >
              </div>
              <Field.Set>
                <Field.Legend variant="label">{rt.t('checkout.address')}</Field.Legend>
                <Field.Group class="gap-4">
                  <Field.Field
                    ><Field.Label for="or-line1">{rt.t('checkout.line1')}</Field.Label><Input
                      id="or-line1"
                      autocomplete="address-line1"
                      bind:value={address.line1}
                    /></Field.Field
                  >
                  <div class="grid gap-4 sm:grid-cols-[8rem_1fr_6rem]">
                    <Field.Field
                      ><Field.Label for="or-zip">{rt.t('checkout.postal_code')}</Field.Label><Input
                        id="or-zip"
                        autocomplete="postal-code"
                        bind:value={address.postal_code}
                      /></Field.Field
                    >
                    <Field.Field
                      ><Field.Label for="or-city">{rt.t('checkout.city')}</Field.Label><Input
                        id="or-city"
                        autocomplete="address-level2"
                        bind:value={address.city}
                      /></Field.Field
                    >
                    <Field.Field
                      ><Field.Label for="or-country">{rt.t('checkout.country')}</Field.Label><Input
                        id="or-country"
                        autocomplete="country"
                        maxlength={2}
                        placeholder="EE"
                        bind:value={address.country}
                      /></Field.Field
                    >
                  </div>
                </Field.Group>
              </Field.Set>
            {/if}
            <Field.Field>
              <Field.Label for="or-notes">{rt.t('checkout.notes')}</Field.Label>
              <Textarea id="or-notes" bind:value={notes} />
            </Field.Field>
            <rt.components.Slot name="checkout.extra_fields" />
          </Field.Group>
        </div>
      </section>
      <OptionalFees cart={data.cart} step="02" />
      <section class={box} aria-labelledby="or-terms-title">
        <h2 id="or-terms-title" class={boxHead}>
          <span class="mq-mono text-sm font-normal" aria-hidden="true">{pad(hasFees ? 3 : 2)}</span>{rt.t('checkout.terms_title')}
        </h2>
        <div class="p-4 md:p-6">
          <Field.Group>
            <ScrollArea class="h-44 border border-(--mq-ink) bg-white" aria-label={rt.t('checkout.terms_title')}>
              <div class="p-4 text-base leading-snug whitespace-pre-wrap">{rt.shop.terms.text}</div>
            </ScrollArea>
            {#if rt.shop.cancellation_policy.length}
              <ul class="mq-mono flex flex-col gap-1 text-xs uppercase">
                {#each rt.shop.cancellation_policy as c (c.hours_before)}<li>
                    {rt.t('checkout.cancellation', { hours: c.hours_before, pct: c.refund_pct })}
                  </li>{/each}
              </ul>
            {/if}
            <Field.Field orientation="horizontal" data-invalid={!!errors.terms_accepted || undefined}>
              <Checkbox id="or-terms" bind:checked={terms} aria-invalid={!!errors.terms_accepted} />
              <Field.Label for="or-terms" class="font-normal">{rt.t('checkout.terms')}</Field.Label>
            </Field.Field>
            {#if errors.terms_accepted}<Field.Error>{errors.terms_accepted}</Field.Error>{/if}
          </Field.Group>
        </div>
        <Button type="submit" class={[cta, 'w-full justify-between border-t border-(--mq-ink)']} disabled={busy || !cart.lines.length}>
          {rt.shop.payment
            ? rt.t('checkout.pay', { amount: rt.format.money(cart.quote?.total) })
            : rt.t('checkout.place')}{#if busy}<Spinner />{:else}<ArrowRightIcon class="mq-arrow" />{/if}
        </Button>
      </section>
      {#if !rt.shop.payment}<p class="mq-mono -mt-3 text-center text-xs uppercase">
          {rt.t('checkout.pay_at_pickup')}
        </p>{/if}
    </form>
  {/if}
  <section class={[box, 'h-fit lg:sticky lg:top-[calc(var(--mq-head)+1rem)]']} aria-labelledby="or-ticket">
    <div class="flex flex-col gap-2 bg-(--mq-accent) px-5 py-4 text-(--mq-on-accent)">
      <h2 id="or-ticket" class="mq-tight text-[1.75rem] leading-none font-bold uppercase">{rt.t('checkout.summary')}</h2>
      <p class="mq-mono text-xs uppercase">{rt.format.datetime(cart.starts_at)} – {rt.format.datetime(cart.ends_at)}</p>
    </div>
    <div class="mq-perf mx-0 p-5 pt-6">{#if cart.quote}<PriceSummary quote={cart.quote} />{/if}</div>
  </section>
</div>
