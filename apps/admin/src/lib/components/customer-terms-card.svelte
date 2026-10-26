<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { formatMoney } from '@openrent/ui/openrent';
  import { api, t, toast, notifyError, fieldErrors, session, minorFromInput, majorFromMinor } from '#lib';

  /**
   * Account terms of a business customer (FR-CUS-7): booking on account, payment terms, credit limit,
   * required PO numbers and monthly invoices, with what the customer owes now.
   */
  let { customer, onsaved }: { customer: any; onsaved: () => void } = $props();
  const currency = $derived(session.currency);
  let f = $state({ on_account: false, payment_terms_days: '', credit_limit: '', po_required: false, invoice_schedule: 'per_order' });
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  $effect(() => {
    const b = customer.b2b;
    f = {
      on_account: b.on_account, payment_terms_days: b.payment_terms_days == null ? '' : String(b.payment_terms_days),
      credit_limit: b.credit_limit == null ? '' : majorFromMinor(b.credit_limit), po_required: b.po_required, invoice_schedule: b.invoice_schedule,
    };
  });
  const available = $derived(customer.b2b.credit_limit == null ? null : Math.max(0, customer.b2b.credit_limit - (customer.open_balance ?? 0)));

  async function save() {
    busy = true;
    errors = {};
    try {
      await api.patch(`/customers/${customer.id}`, {
        b2b: {
          on_account: f.on_account, po_required: f.po_required, invoice_schedule: f.on_account ? f.invoice_schedule : 'per_order',
          // A number input gives a number once something is typed.
          payment_terms_days: String(f.payment_terms_days ?? '').trim() === '' ? null : Number(f.payment_terms_days),
          credit_limit: String(f.credit_limit ?? '').trim() === '' ? null : minorFromInput(f.credit_limit),
        },
      });
      toast.success(t('common.saved'));
      onsaved();
    } catch (e) {
      errors = Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^b2b\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(e);
    } finally {
      busy = false;
    }
  }

  async function invoiceNow() {
    busy = true;
    try {
      const doc = await api.post(`/customers/${customer.id}/actions/invoice_now`);
      toast.success(t('customer.terms.invoiced', { number: doc.number }));
      onsaved();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }
</script>

<Card.Root data-testid="customer-terms">
  <Card.Header>
    <Card.Title>{t('customer.terms.title')}</Card.Title>
    <Card.Description>{t('customer.terms.description')}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <dl class="grid grid-cols-2 gap-2 text-sm">
      <dt class="text-muted-foreground">{t('customer.terms.owed')}</dt>
      <dd class="text-right tabular-nums" data-testid="customer-owed">{formatMoney({ amount: customer.open_balance ?? 0, currency })}</dd>
      {#if available !== null}
        <dt class="text-muted-foreground">{t('customer.terms.available')}</dt>
        <dd class="text-right tabular-nums">{formatMoney({ amount: available, currency })}</dd>
      {/if}
    </dl>
    <Field.Group>
      <Field.Field orientation="horizontal">
        <Switch id="b2b-on" bind:checked={f.on_account} />
        <Field.Content><Field.Label for="b2b-on">{t('customer.terms.on_account')}</Field.Label><Field.Description>{t('customer.terms.on_account_hint')}</Field.Description></Field.Content>
      </Field.Field>
      {#if f.on_account}
        <div class="grid gap-4 sm:grid-cols-2">
          <Field.Field data-invalid={!!errors.payment_terms_days || undefined}>
            <Field.Label for="b2b-days">{t('customer.terms.days')}</Field.Label>
            <Input id="b2b-days" type="number" inputmode="numeric" min="0" max="365" placeholder="14" bind:value={f.payment_terms_days} aria-invalid={!!errors.payment_terms_days} />
            {#if errors.payment_terms_days}<Field.Error>{errors.payment_terms_days}</Field.Error>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!errors.credit_limit || undefined}>
            <Field.Label for="b2b-limit">{t('customer.terms.credit_limit')}</Field.Label>
            <Input id="b2b-limit" inputmode="decimal" placeholder={t('customer.terms.no_limit')} bind:value={f.credit_limit} aria-invalid={!!errors.credit_limit} />
            {#if errors.credit_limit}<Field.Error>{errors.credit_limit}</Field.Error>{/if}
          </Field.Field>
        </div>
        <Field.Field data-invalid={!!errors.invoice_schedule || undefined}>
          <Field.Label for="b2b-schedule">{t('customer.terms.schedule')}</Field.Label>
          <NativeSelect.Root id="b2b-schedule" class="w-full" bind:value={f.invoice_schedule}>
            <NativeSelect.Option value="per_order">{t('customer.terms.schedule.per_order')}</NativeSelect.Option>
            <NativeSelect.Option value="monthly">{t('customer.terms.schedule.monthly')}</NativeSelect.Option>
          </NativeSelect.Root>
          {#if errors.invoice_schedule}<Field.Error>{errors.invoice_schedule}</Field.Error>{/if}
        </Field.Field>
      {/if}
      <Field.Field orientation="horizontal">
        <Switch id="b2b-po" bind:checked={f.po_required} />
        <Field.Content><Field.Label for="b2b-po">{t('customer.terms.po_required')}</Field.Label><Field.Description>{t('customer.terms.po_required_hint')}</Field.Description></Field.Content>
      </Field.Field>
    </Field.Group>
  </Card.Content>
  {#if session.can('customers:write')}
    <Card.Footer class="flex flex-wrap gap-2">
      <Button onclick={save} disabled={busy}>{t('common.save')}</Button>
      {#if customer.b2b.on_account && customer.b2b.invoice_schedule === 'monthly' && session.can('documents:write')}
        <Button variant="outline" onclick={invoiceNow} disabled={busy}>{t('customer.terms.invoice_now')}</Button>
      {/if}
    </Card.Footer>
  {/if}
</Card.Root>
