<script lang="ts">
  import { getRuntime, RuntimeError, type CheckoutData } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
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
  import PageHead from '../snippets/PageHead.svelte';
  import { big } from '../lib/nightfall.ts';

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

<PageHead title={rt.t('checkout.title')} />
<div class="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
  {#if payment}
    <Card.Root class="h-fit">
      <Card.Header><Card.Title>{rt.t('checkout.payment')}</Card.Title></Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#if paymentError}<Alert.Root variant="destructive"
            ><CircleAlertIcon /><Alert.Title>{paymentError}</Alert.Title></Alert.Root
          >{/if}
        <rt.components.Payment
          clientSecret={payment.clientSecret}
          publishableKey={payment.publishableKey}
          returnUrl={payment.returnUrl}
          onerror={(m) => (paymentError = m)}
        />
      </Card.Content>
    </Card.Root>
  {:else}
    <form class="flex flex-col gap-6" onsubmit={place} novalidate>
      <Card.Root>
        <Card.Header>
          <Card.Title>{rt.t('checkout.contact')}</Card.Title>
          <Card.Description>{rt.t('checkout.contact_hint')}</Card.Description>
        </Card.Header>
        <Card.Content>
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
        </Card.Content>
      </Card.Root>
      <OptionalFees cart={data.cart} />
      <Card.Root>
        <Card.Header><Card.Title>{rt.t('checkout.terms_title')}</Card.Title></Card.Header>
        <Card.Content>
          <Field.Group>
            <ScrollArea class="h-40 rounded-2xl border border-white/10 bg-black/30" aria-label={rt.t('checkout.terms_title')}>
              <div class="p-4 text-sm leading-relaxed whitespace-pre-wrap text-white/75">{rt.shop.terms.text}</div>
            </ScrollArea>
            {#if rt.shop.cancellation_policy.length}
              <ul class="text-muted-foreground list-disc pl-5 text-sm">
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
        </Card.Content>
        <Card.Footer class="flex-col items-stretch gap-2">
          <Button type="submit" class={big} disabled={busy || !cart.lines.length}>
            {#if busy}<Spinner />{/if}{rt.shop.payment
              ? rt.t('checkout.pay', { amount: rt.format.money(cart.quote?.total) })
              : rt.t('checkout.place')}
          </Button>
          {#if !rt.shop.payment}<p class="text-muted-foreground text-center text-sm">
              {rt.t('checkout.pay_at_pickup')}
            </p>{/if}
        </Card.Footer>
      </Card.Root>
    </form>
  {/if}
  <Card.Root class="h-fit lg:sticky lg:top-24">
    <Card.Header>
      <Card.Title>{rt.t('checkout.summary')}</Card.Title>
      <Card.Description
        >{rt.format.datetime(cart.starts_at)} – {rt.format.datetime(cart.ends_at)}</Card.Description
      >
    </Card.Header>
    <Card.Content
      >{#if cart.quote}<PriceSummary quote={cart.quote} />{/if}</Card.Content
    >
  </Card.Root>
</div>
