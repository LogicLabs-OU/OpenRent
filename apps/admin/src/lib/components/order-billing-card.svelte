<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import { Button } from '@openrent/ui/button';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import { api, t, toast, notifyError } from '#lib';
  import BillingDetailsDialog from './billing-details-dialog.svelte';

  /**
   * The billing details printed on the order's documents (ADR 0012): the ones chosen at checkout, set
   * here by staff, or else the customer's own. They change until an invoice is issued; on a draft or a
   * quote the tax is worked out again.
   */
  let { order, onchange }: { order: any; onchange: () => void } = $props();
  let open = $state(false);
  const b = $derived(order.billing);
  const lines = (a: any) => [a?.line1, a?.line2, [a?.postal_code, a?.city].filter(Boolean).join(' '), a?.country].filter(Boolean).join(', ');

  async function save(data: Record<string, unknown>) {
    await api.put(`/orders/${order.id}/billing`, { billing: data });
    toast.success(t('common.saved'));
    onchange();
  }
  async function reset() {
    try {
      await api.put(`/orders/${order.id}/billing`, { billing: null });
      toast.success(t('common.saved'));
      onchange();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<Card.Root data-testid="order-billing">
  <Card.Header>
    <Card.Title>{t('billing.order_title')}</Card.Title>
    <Card.Action><Button variant="ghost" size="icon-sm" aria-label={t('billing.order_edit')} onclick={() => (open = true)}><PencilIcon /></Button></Card.Action>
  </Card.Header>
  <Card.Content class="flex flex-col gap-1 text-sm">
    {#if b}
      <span class="font-medium">{b.kind === 'company' ? b.company_name : b.name}</span>
      {#if b.kind === 'company'}<span class="text-muted-foreground">{b.name}</span>{/if}
      {#if b.tax_id}<span class="text-muted-foreground">{b.tax_id}{b.tax_id_check?.status ? ` · ${t(`customer.tax_check.${b.tax_id_check.status}` as any)}` : ''}</span>{/if}
      {#if lines(b.address)}<span class="text-muted-foreground">{lines(b.address)}</span>{/if}
      <div class="mt-2"><Button size="sm" variant="ghost" onclick={reset}>{t('billing.order_reset')}</Button></div>
    {:else}
      <p class="text-muted-foreground">{t('billing.order_customer')}</p>
    {/if}
  </Card.Content>
</Card.Root>

<BillingDetailsDialog bind:open mode="billing" title={t('billing.order_edit')} initial={b ?? { name: order.customer?.name ?? '' }} {save} />
