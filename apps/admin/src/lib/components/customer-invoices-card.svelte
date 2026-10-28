<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Money } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import FileCodeIcon from '@lucide/svelte/icons/file-code';
  import { download } from '#lib/api.ts';
  import { api, t, toast, notifyError, fieldErrors, session, minorFromInput, majorFromMinor, openHtml, getLocale } from '#lib';

  /**
   * Invoices to the customer that belong to no booking (ADR 0014), such as a membership fee or something
   * sold at the counter: what is owed on each, payments taken by staff, payment links and the saved card.
   */
  let { customerId }: { customerId: string } = $props();
  let invoices = $state<any[]>([]);
  const canPay = $derived(session.can('payments:write'));
  const canIssue = $derived(session.can('documents:write'));

  async function load() {
    invoices = (await api.get(`/customers/${customerId}/invoices`)).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  let issuing = $state(false);
  let draft = $state({ description: '', amount: '', request: true });
  let issueErrors = $state<Record<string, string>>({});
  async function issue(e: SubmitEvent) {
    e.preventDefault();
    issueErrors = {};
    try {
      await api.post(`/customers/${customerId}/invoices`, { lines: [{ description: draft.description.trim(), amount: minorFromInput(draft.amount || 0) }], request_payment: draft.request });
      toast.success(t('customer_invoice.issued'));
      issuing = false;
      draft = { description: '', amount: '', request: true };
      await load();
    } catch (err) {
      const f = fieldErrors(err);
      issueErrors = { description: f['lines[0].description'] ?? f.lines ?? '', amount: f['lines[0].amount'] ?? '' };
      if (!issueErrors.description && !issueErrors.amount) notifyError(err);
    }
  }

  let paying = $state<any | null>(null);
  let payment = $state({ amount: '', method: 'cash' });
  let payError = $state('');
  function startPayment(inv: any) {
    paying = inv;
    payment = { amount: majorFromMinor(inv.due.amount), method: 'cash' };
    payError = '';
  }
  async function record(e: SubmitEvent) {
    e.preventDefault();
    payError = '';
    try {
      await api.post(`/documents/${paying.id}/payments`, { amount: minorFromInput(payment.amount || 0), method: payment.method });
      toast.success(t('customer_invoice.payment_recorded'));
      paying = null;
      await load();
    } catch (err) {
      payError = fieldErrors(err).amount ?? '';
      if (!payError) notifyError(err);
    }
  }

  async function act(inv: any, action: 'request_payment' | 'charge_card') {
    try {
      await api.post(`/documents/${inv.id}/actions/${action}`, {});
      toast.success(action === 'request_payment' ? t('customer_invoice.link_sent') : t('customer_invoice.card_charged'));
      await load();
    } catch (err) {
      notifyError(err);
    }
  }
</script>

<Card.Root data-testid="customer-invoices">
  <Card.Header>
    <Card.Title>{t('customer_invoice.title')}</Card.Title>
    <Card.Description>{t('customer_invoice.hint')}</Card.Description>
    {#if canIssue}<Card.Action><Button size="sm" variant="outline" onclick={() => (issuing = true)}><PlusIcon />{t('customer_invoice.new')}</Button></Card.Action>{/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-2 text-sm">
    {#each invoices as inv (inv.id)}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
        <span class="flex items-center gap-1">
          <Button variant="link" class="h-auto p-0" onclick={() => openHtml(`/documents/${inv.id}/html`).catch(notifyError)}>{inv.number}</Button>
          {#if inv.einvoice_format}<Button variant="ghost" size="icon-sm" aria-label={t('document.einvoice')} title={t('document.einvoice')} onclick={() => download(`/documents/${inv.id}/einvoice`).catch(notifyError)}><FileCodeIcon /></Button>{/if}
        </span>
        <span class="flex items-center gap-2">
          <Money value={inv.total} />
          {#if inv.status === 'voided'}
            <Badge variant="outline">{t('customer_invoice.voided')}</Badge>
          {:else if inv.due.amount > 0}
            <Badge variant="destructive">{t('customer_invoice.due', { amount: new Intl.NumberFormat(getLocale(), { style: 'currency', currency: inv.due.currency }).format(inv.due.amount / 100) })}</Badge>
          {:else}
            <Badge variant="secondary">{t('customer_invoice.paid')}</Badge>
          {/if}
          {#if canPay && inv.status !== 'voided' && inv.due.amount > 0}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={t('customer_invoice.actions', { number: inv.number })}><EllipsisIcon /></Button>{/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item onclick={() => startPayment(inv)}>{t('customer_invoice.record_payment')}</DropdownMenu.Item>
                <DropdownMenu.Item onclick={() => act(inv, 'request_payment')}>{t('customer_invoice.send_link')}</DropdownMenu.Item>
                <DropdownMenu.Item onclick={() => act(inv, 'charge_card')}>{t('customer_invoice.charge_card')}</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
        </span>
      </div>
    {:else}
      <p class="text-muted-foreground">{t('customer_invoice.none')}</p>
    {/each}
  </Card.Content>
</Card.Root>

<Dialog.Root bind:open={issuing}>
  <Dialog.Content>
    <form class="flex flex-col gap-4" onsubmit={issue} novalidate>
      <Dialog.Header><Dialog.Title>{t('customer_invoice.new')}</Dialog.Title><Dialog.Description>{t('customer_invoice.new_hint')}</Dialog.Description></Dialog.Header>
      <Field.Group>
        <Field.Field data-invalid={!!issueErrors.description || undefined}>
          <Field.Label for="ci-desc">{t('customer_invoice.description')}</Field.Label>
          <Input id="ci-desc" bind:value={draft.description} aria-invalid={!!issueErrors.description} />
          {#if issueErrors.description}<Field.Error>{issueErrors.description}</Field.Error>{/if}
        </Field.Field>
        <Field.Field data-invalid={!!issueErrors.amount || undefined}>
          <Field.Label for="ci-amount">{t('customer_invoice.amount')}</Field.Label>
          <Input id="ci-amount" type="number" min="0" step="0.01" bind:value={draft.amount} aria-invalid={!!issueErrors.amount} />
          <Field.Description>{t('customer_invoice.amount_hint')}</Field.Description>
          {#if issueErrors.amount}<Field.Error>{issueErrors.amount}</Field.Error>{/if}
        </Field.Field>
        <Field.Field orientation="horizontal">
          <Checkbox id="ci-request" bind:checked={draft.request} />
          <Field.Label for="ci-request">{t('customer_invoice.request')}</Field.Label>
        </Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (issuing = false)}>{t('common.cancel')}</Button>
        <Button type="submit">{t('customer_invoice.issue')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!paying} onOpenChange={(o) => !o && (paying = null)}>
  <Dialog.Content>
    {#if paying}
      <form class="flex flex-col gap-4" onsubmit={record} novalidate>
        <Dialog.Header><Dialog.Title>{t('customer_invoice.record_title', { number: paying.number })}</Dialog.Title></Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!payError || undefined}>
            <Field.Label for="ci-pay">{t('customer_invoice.amount_paid')}</Field.Label>
            <Input id="ci-pay" type="number" min="0" step="0.01" bind:value={payment.amount} aria-invalid={!!payError} />
            {#if payError}<Field.Error>{payError}</Field.Error>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="ci-method">{t('payment.method_label')}</Field.Label>
            <NativeSelect id="ci-method" bind:value={payment.method}>
              {#each ['cash', 'bank_transfer', 'card_terminal', 'other'] as m (m)}<NativeSelectOption value={m}>{t(`payment.method.${m}` as any)}</NativeSelectOption>{/each}
            </NativeSelect>
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (paying = null)}>{t('common.cancel')}</Button>
          <Button type="submit">{t('customer_invoice.record_payment')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
