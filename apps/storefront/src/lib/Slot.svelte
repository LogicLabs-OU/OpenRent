<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Badge } from '@openrent/ui/badge';
  import { checkoutExtra, type CheckoutFieldDef } from './extensions.svelte.ts';
  import { t } from './i18n/index.ts';
  import AccountExtra from './AccountExtra.svelte';
  import BundlePicker from './BundlePicker.svelte';
  import Accessories from './Accessories.svelte';
  import ContactSection from './ContactSection.svelte';
  import LocationsSection from './LocationsSection.svelte';
  import BillingPicker from './BillingPicker.svelte';
  import LocationPicker from './LocationPicker.svelte';
  import ElsewhereHint from './ElsewhereHint.svelte';
  import DeliveryChoice from './DeliveryChoice.svelte';
  import OrderActions from './OrderActions.svelte';

  /**
   * Extension points in theme layouts (FR-PLG-6). `header.after` and `footer.before` show the shop's
   * own HTML (Admin → Themes → Custom code), which the API cleans on save. `checkout.extra_fields`
   * shows plugins' checkout fields, and booking on account for signed-in business customers (FR-CUS-7);
   * `product.before_add` shows plugins' product badges (FR-PLG-5).
   */
  let { name, context = {} }: { name: string; context?: Record<string, unknown> } = $props();
  const html = $derived(name === 'header.after' ? page.data.code?.header_html : name === 'footer.before' ? page.data.code?.footer_html : '');
  const fields = $derived<CheckoutFieldDef[]>(name === 'checkout.extra_fields' ? (page.data.extensions?.checkout_fields ?? []) : []);
  const b2b = $derived(name === 'checkout.extra_fields' && page.data.b2b?.on_account ? page.data.b2b : null);
  // Prices in other currencies (FR-I18N-7): the choice under the header, a word at checkout and on products.
  const dc = $derived(page.data.shop?.displayCurrency as { base: string; shown: string; choices: string[] } | undefined);
  async function chooseCurrency(code: string) {
    await fetch('/_or/currency', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currency: code }) });
    await invalidateAll();
  }
  const taxHint = $derived(name === 'product.before_add' && page.data.shop ? (page.data.shop.displayPricesIncludingTax ? 'product.prices_incl_tax' : 'product.prices_excl_tax') : null);
  // Booking updates by SMS or WhatsApp, when the shop sends them (FR-NOT-4).
  const texts = $derived((name === 'checkout.extra_fields' ? (['sms', 'whatsapp'] as const).filter((k) => page.data.messaging?.[k]) : []) as ('sms' | 'whatsapp')[]);
  const locale = $derived(page.data.shop?.locale);
  const money = (m: { amount: number; currency: string }) => new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amount / 100);
  const badges = $derived<{ label: string; tone: string }[]>(name === 'product.before_add' ? ((context.product as any)?.badges ?? []) : []);
  const id = (key: string) => `or-extra-${key.replace(/[^a-z0-9]/gi, '-')}`;
  const TONE: Record<string, string> = { success: 'bg-emerald-700 text-white', warning: 'bg-amber-500 text-black' };
</script>

{#if name === 'order.actions' && context.order}
  <OrderActions order={context.order as any} />
{/if}
{#if name === 'dates.after'}
  <LocationPicker />
{/if}
{#if name === 'product.before_add' && context.product}
  <ElsewhereHint product={context.product as any} />
{/if}
{#if name === 'product.before_add' && (context.product as any)?.meter}
  <p class="text-sm opacity-80" data-testid="meter-price">{(context.product as any).meter.description}</p>
{/if}
{#if name === 'product.before_add' && (context.product as any)?.bundle?.slots?.length}
  <BundlePicker product={context.product as any} />
{/if}
{#if name === 'product.before_add' && ((context.product as any)?.accessories?.length || (context.product as any)?.related?.length)}
  <Accessories product={context.product as any} />
{/if}
{#if name === 'header.after' && dc && dc.choices.length > 1}
  <div class="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-4 pt-2 text-sm" data-testid="currency-switcher">
    <label for="or-currency" class="opacity-70">{t('currency.label', {}, locale)}</label>
    <NativeSelect id="or-currency" size="sm" value={dc.shown} onchange={(e) => chooseCurrency((e.currentTarget as HTMLSelectElement).value)}>
      {#each dc.choices as c (c)}<NativeSelectOption value={c}>{c}</NativeSelectOption>{/each}
    </NativeSelect>
    {#if dc.shown !== dc.base}<span class="opacity-70">{t('currency.approx', { base: dc.base }, locale)}</span>{/if}
  </div>
{/if}
{#if name === 'checkout.extra_fields'}
  <DeliveryChoice />
{/if}
{#if name === 'checkout.extra_fields' && Array.isArray(page.data.billingProfiles)}
  <BillingPicker profiles={page.data.billingProfiles} />
{/if}
{#if name === 'checkout.extra_fields' && dc && dc.shown !== dc.base}
  <p class="text-sm opacity-80" data-testid="checkout-currency-note">{t('currency.checkout_note', { base: dc.base, shown: dc.shown }, locale)}</p>
{/if}
{#if taxHint}
  <p class="text-xs opacity-70" data-testid="price-tax-hint">{t(taxHint, {}, locale)}</p>
{/if}
{#if name === 'section.plugin' && (context.section as any)?.type === 'plugin:openrent:contact'}
  <ContactSection section={context.section as any} />
{:else if name === 'section.plugin' && (context.section as any)?.type === 'plugin:openrent:locations'}
  <LocationsSection section={context.section as any} />
{:else if name === 'section.plugin'}
  <!-- A plugin's home page section (FR-THM-12): HTML the API rendered and cleaned. -->
  <div data-slot="section.plugin" data-plugin-section={(context.section as any)?.type}>{@html page.data.pluginSections?.[(context.section as any)?.id] ?? ''}</div>
{:else if name === 'account.extra'}
  <AccountExtra />
{:else if b2b}
  <Field.Set data-testid="checkout-on-account">
    <Field.Legend variant="label">{t('checkout.b2b.title', {}, locale)}</Field.Legend>
    <Field.Field orientation="horizontal" data-invalid={!!checkoutExtra.errors['b2b.pay_on_account'] || undefined}>
      <Checkbox id="or-b2b-pay" checked={checkoutExtra.values['b2b.pay_on_account'] === true} onCheckedChange={(v) => (checkoutExtra.values['b2b.pay_on_account'] = v === true)} aria-invalid={!!checkoutExtra.errors['b2b.pay_on_account']} />
      <Field.Content>
        <Field.Label for="or-b2b-pay" class="font-normal">{t('checkout.b2b.pay_on_account', {}, locale)}</Field.Label>
        <Field.Description>
          {t('checkout.b2b.hint', { days: b2b.payment_terms_days }, locale)}{#if b2b.available_credit} {t('checkout.b2b.credit_left', { amount: money(b2b.available_credit) }, locale)}{/if}
        </Field.Description>
      </Field.Content>
    </Field.Field>
    {#if checkoutExtra.errors['b2b.pay_on_account']}<Field.Error>{checkoutExtra.errors['b2b.pay_on_account']}</Field.Error>{/if}
    <Field.Field data-invalid={!!checkoutExtra.errors['b2b.po_number'] || undefined}>
      <Field.Label for="or-b2b-po">{t('checkout.b2b.po_number', {}, locale)}</Field.Label>
      <Input id="or-b2b-po" required={b2b.po_required} maxlength={100} value={String(checkoutExtra.values['b2b.po_number'] ?? '')} oninput={(e) => (checkoutExtra.values['b2b.po_number'] = (e.currentTarget as HTMLInputElement).value)} aria-invalid={!!checkoutExtra.errors['b2b.po_number']} />
      {#if checkoutExtra.errors['b2b.po_number']}<Field.Error>{checkoutExtra.errors['b2b.po_number']}</Field.Error>{/if}
    </Field.Field>
  </Field.Set>
{/if}
{#if texts.length}
  <Field.Set data-testid="checkout-text-updates">
    <Field.Legend variant="label">{t('checkout.texts.title', {}, locale)}</Field.Legend>
    {#each texts as k (k)}
      <Field.Field orientation="horizontal">
        <Checkbox id={`or-texts-${k}`} checked={checkoutExtra.values[`messages.${k}`] === true} onCheckedChange={(v) => (checkoutExtra.values[`messages.${k}`] = v === true)} />
        <Field.Label for={`or-texts-${k}`} class="font-normal">{t(`checkout.texts.${k}`, {}, locale)}</Field.Label>
      </Field.Field>
    {/each}
    <Field.Description>{t('checkout.texts.hint', {}, locale)}</Field.Description>
  </Field.Set>
{/if}
{#if html}
  <div class="or-shop-html" data-slot={name}>{@html html}</div>
{:else if fields.length}
  <Field.Group data-slot={name}>
    {#each fields as f (f.key)}
      {@const err = checkoutExtra.errors[f.key]}
      {#if f.type === 'checkbox'}
        <Field.Field orientation="horizontal" data-invalid={!!err || undefined}>
          <Checkbox id={id(f.key)} checked={checkoutExtra.values[f.key] === true} onCheckedChange={(v) => (checkoutExtra.values[f.key] = v === true)} aria-invalid={!!err} />
          <Field.Label for={id(f.key)} class="font-normal">{f.label}</Field.Label>
        </Field.Field>
      {:else}
        <Field.Field data-invalid={!!err || undefined}>
          <Field.Label for={id(f.key)}>{f.label}</Field.Label>
          {#if f.type === 'select'}
            <NativeSelect id={id(f.key)} class="w-full" value={String(checkoutExtra.values[f.key] ?? '')} onchange={(e) => (checkoutExtra.values[f.key] = (e.currentTarget as HTMLSelectElement).value)} aria-invalid={!!err}>
              <NativeSelectOption value=""></NativeSelectOption>
              {#each f.options as o (o.value)}<NativeSelectOption value={o.value}>{o.label}</NativeSelectOption>{/each}
            </NativeSelect>
          {:else}
            <Input id={id(f.key)} required={f.required} value={String(checkoutExtra.values[f.key] ?? '')} oninput={(e) => (checkoutExtra.values[f.key] = (e.currentTarget as HTMLInputElement).value)} aria-invalid={!!err} />
          {/if}
          {#if f.help && !err}<Field.Description>{f.help}</Field.Description>{/if}
        </Field.Field>
      {/if}
      {#if err}<Field.Error>{err}</Field.Error>{/if}
    {/each}
  </Field.Group>
{:else if badges.length}
  <div class="flex flex-wrap gap-1.5" data-slot={name}>
    {#each badges as b, i (i)}<Badge class={TONE[b.tone] ?? ''} variant={b.tone === 'default' ? 'secondary' : 'default'}>{b.label}</Badge>{/each}
  </div>
{:else if !b2b && !texts.length}
  <span hidden data-slot={name}></span>
{/if}
