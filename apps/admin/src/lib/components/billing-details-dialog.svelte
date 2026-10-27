<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { t, notifyError, fieldErrors } from '#lib';

  /**
   * Billing details (private, or a company with its VAT number) or a delivery address in a dialog. `save`
   * sends them; field errors from the answer show next to the fields, others as a toast.
   */
  type Mode = 'billing' | 'address';
  let {
    open = $bindable(false),
    mode,
    title,
    initial = {},
    save,
  }: { open?: boolean; mode: Mode; title: string; initial?: Record<string, any>; save: (data: Record<string, unknown>) => Promise<unknown> } = $props();

  const FIELDS = ['line1', 'line2', 'postal_code', 'city', 'country'] as const;
  let form = $state<Record<string, any>>({});
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    errors = {};
    const a = initial.address ?? {};
    form = {
      kind: initial.kind ?? 'private', name: initial.name ?? '', company_name: initial.company_name ?? '', tax_id: initial.tax_id ?? '',
      label: initial.label ?? '', recipient: initial.recipient ?? '', phone: initial.phone ?? '',
      address: Object.fromEntries(FIELDS.map((k) => [k, a[k] ?? ''])),
    };
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    const address = Object.fromEntries(Object.entries(form.address as Record<string, string>).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const data =
      mode === 'billing'
        ? { kind: form.kind, name: form.name, company_name: form.kind === 'company' ? form.company_name || null : null, tax_id: form.kind === 'company' ? form.tax_id || null : null, address }
        : { label: form.label || null, recipient: form.recipient || null, phone: form.phone || null, address };
    try {
      await save(data);
      open = false;
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-lg">
    <form class="flex flex-col gap-4" onsubmit={submit}>
      <Dialog.Header><Dialog.Title>{title}</Dialog.Title></Dialog.Header>
      <Field.Group class="gap-4">
        {#if mode === 'billing'}
          <Field.Field>
            <Field.Label for="bd-kind">{t('billing.kind')}</Field.Label>
            <NativeSelect id="bd-kind" bind:value={form.kind}>
              <NativeSelectOption value="private">{t('billing.kind_private')}</NativeSelectOption>
              <NativeSelectOption value="company">{t('billing.kind_company')}</NativeSelectOption>
            </NativeSelect>
          </Field.Field>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="bd-name">{form.kind === 'company' ? t('billing.contact_name') : t('field.name')}</Field.Label>
            <Input id="bd-name" maxlength={200} bind:value={form.name} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          {#if form.kind === 'company'}
            <Field.Field data-invalid={!!errors.company_name || undefined}>
              <Field.Label for="bd-company">{t('customers.company')}</Field.Label>
              <Input id="bd-company" maxlength={200} bind:value={form.company_name} aria-invalid={!!errors.company_name} />
              {#if errors.company_name}<Field.Error>{errors.company_name}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.tax_id || undefined}>
              <Field.Label for="bd-tax">{t('field.tax_id')}</Field.Label>
              <Input id="bd-tax" maxlength={40} bind:value={form.tax_id} aria-invalid={!!errors.tax_id} />
              {#if errors.tax_id}<Field.Error>{errors.tax_id}</Field.Error>{/if}
            </Field.Field>
          {/if}
        {:else}
          <Field.Field>
            <Field.Label for="bd-label">{t('billing.label')}</Field.Label>
            <Input id="bd-label" maxlength={80} bind:value={form.label} />
          </Field.Field>
          <Field.Field>
            <Field.Label for="bd-recipient">{t('billing.recipient')}</Field.Label>
            <Input id="bd-recipient" maxlength={200} bind:value={form.recipient} />
          </Field.Field>
          <Field.Field>
            <Field.Label for="bd-phone">{t('field.phone')}</Field.Label>
            <Input id="bd-phone" type="tel" maxlength={40} bind:value={form.phone} />
          </Field.Field>
        {/if}
        {#each FIELDS as k (k)}
          <Field.Field data-invalid={!!errors[`address.${k}`] || undefined}>
            <Field.Label for="bd-{k}">{t(`customer.address.${k}` as any)}</Field.Label>
            <Input id="bd-{k}" maxlength={k === 'country' ? 2 : 200} bind:value={form.address[k]} aria-invalid={!!errors[`address.${k}`]} />
            {#if errors[`address.${k}`]}<Field.Error>{errors[`address.${k}`]}</Field.Error>{/if}
          </Field.Field>
        {/each}
      </Field.Group>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('common.save')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
