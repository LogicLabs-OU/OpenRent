<script lang="ts">
  import { page } from '$app/state';
  import * as Field from '@openrent/ui/field';
  import * as RadioGroup from '@openrent/ui/radio-group';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { checkoutExtra } from './extensions.svelte.ts';
  import { t } from './i18n/index.ts';

  /**
   * At checkout, a signed-in customer bills the booking to billing details they saved (ADR 0012), or to the
   * details typed below, which they may save for next time. The order keeps a copy of the ones chosen.
   */
  type Profile = { id: string; kind: 'private' | 'company'; name: string; company_name: string | null; tax_id: string | null; address: { city?: string } ; is_default: boolean };
  let { profiles }: { profiles: Profile[] } = $props();
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0]) => t(key, {}, locale);
  const OTHER = 'other';
  // The default billing details are chosen until the customer picks others.
  const chosen = $derived(String(checkoutExtra.values['billing.profile_id'] ?? (profiles.find((p) => p.is_default) ?? profiles[0])?.id ?? OTHER));
  $effect(() => {
    if (checkoutExtra.values['billing.profile_id'] === undefined && chosen !== OTHER) checkoutExtra.values['billing.profile_id'] = chosen;
  });
  function pick(v: string) {
    checkoutExtra.values['billing.profile_id'] = v === OTHER ? '' : v;
    if (v !== OTHER) delete checkoutExtra.values['billing.save'];
  }
  const label = (p: Profile) => [p.kind === 'company' ? p.company_name : p.name, p.tax_id, p.address?.city].filter(Boolean).join(' · ');
  const error = $derived(checkoutExtra.errors['billing.profile_id']);
  // Typed details exist only when the theme asks for the company and address at checkout.
  const typed = $derived(page.data.shop?.settings?.checkout_fields === 'address');
</script>

{#if profiles.length || typed}
<Field.Set data-testid="checkout-billing">
  <Field.Legend variant="label">{tr('billing.checkout_title')}</Field.Legend>
  {#if profiles.length}
    <RadioGroup.Root value={chosen || OTHER} onValueChange={pick} aria-invalid={!!error}>
      {#each profiles as p (p.id)}
        <Field.Field orientation="horizontal">
          <RadioGroup.Item id="or-billing-{p.id}" value={p.id} />
          <Field.Label for="or-billing-{p.id}" class="font-normal">{label(p)}</Field.Label>
        </Field.Field>
      {/each}
      <Field.Field orientation="horizontal">
        <RadioGroup.Item id="or-billing-other" value={OTHER} />
        <Field.Label for="or-billing-other" class="font-normal">{typed ? tr('billing.checkout_other') : tr('billing.checkout_own')}</Field.Label>
      </Field.Field>
    </RadioGroup.Root>
    {#if error}<Field.Error>{error}</Field.Error>{/if}
  {/if}
  {#if typed && (!profiles.length || chosen === OTHER || chosen === '')}
    <Field.Field orientation="horizontal">
      <Checkbox id="or-billing-save" checked={checkoutExtra.values['billing.save'] === true} onCheckedChange={(v) => (checkoutExtra.values['billing.save'] = v === true)} />
      <Field.Label for="or-billing-save" class="font-normal">{tr('billing.checkout_save')}</Field.Label>
    </Field.Field>
  {:else if profiles.length && chosen !== OTHER && chosen !== ''}
    <Field.Description>{tr('billing.checkout_hint')}</Field.Description>
  {/if}
</Field.Set>
{/if}
