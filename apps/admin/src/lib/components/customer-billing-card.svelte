<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { api, t, toast, notifyError, confirmAction } from '#lib';
  import BillingDetailsDialog from './billing-details-dialog.svelte';

  /**
   * Billing details and delivery addresses the customer keeps for storefront checkout (ADR 0012). Staff
   * can fix them here; bookings keep the copy they were made with.
   */
  let { customerId }: { customerId: string } = $props();
  let profiles = $state<any[]>([]);
  let addresses = $state<any[]>([]);
  let dialog = $state<{ mode: 'billing' | 'address'; item: any | null } | null>(null);
  let open = $state(false);

  const base = $derived(`/customers/${customerId}`);
  async function load() {
    const [p, a] = await Promise.all([api.get(`${base}/billing_profiles`), api.get(`${base}/addresses`)]);
    profiles = p.data;
    addresses = a.data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  const path = (mode: 'billing' | 'address') => `${base}/${mode === 'billing' ? 'billing_profiles' : 'addresses'}`;
  function edit(mode: 'billing' | 'address', item: any | null) {
    dialog = { mode, item };
    open = true;
  }
  async function save(data: Record<string, unknown>) {
    const d = dialog!;
    if (d.item) await api.patch(`${path(d.mode)}/${d.item.id}`, data);
    else await api.post(path(d.mode), data);
    toast.success(t('common.saved'));
    await load();
  }
  async function makeDefault(mode: 'billing' | 'address', item: any) {
    try {
      await api.patch(`${path(mode)}/${item.id}`, { is_default: true });
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
  async function remove(mode: 'billing' | 'address', item: any) {
    if (!(await confirmAction({ title: t('billing.delete_title'), description: t('billing.delete_description'), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`${path(mode)}/${item.id}`);
      toast.success(t('common.removed'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
  const lines = (a: any) => [a?.line1, a?.line2, [a?.postal_code, a?.city].filter(Boolean).join(' '), a?.country].filter(Boolean).join(', ');
</script>

<Card.Root data-testid="customer-billing">
  <Card.Header>
    <Card.Title>{t('billing.title')}</Card.Title>
    <Card.Description>{t('billing.hint')}</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-6 md:grid-cols-2">
    {#each [['billing', profiles], ['address', addresses]] as const as [mode, list] (mode)}
      <section class="flex flex-col gap-2" aria-labelledby="cb-{mode}">
        <div class="flex items-center justify-between gap-2">
          <h3 id="cb-{mode}" class="text-sm font-medium">{mode === 'billing' ? t('billing.profiles') : t('billing.addresses')}</h3>
          <Button size="sm" variant="outline" onclick={() => edit(mode, null)}><PlusIcon />{t('common.add')}</Button>
        </div>
        {#each list as item (item.id)}
          <div class="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
            <div class="flex min-w-0 flex-col">
              <span class="font-medium">
                {mode === 'billing' ? (item.kind === 'company' ? item.company_name : item.name) : item.label || item.recipient || lines(item.address)}
                {#if item.is_default}<Badge variant="secondary" class="ml-1">{t('billing.default')}</Badge>{/if}
              </span>
              {#if mode === 'billing' && item.tax_id}<span class="text-muted-foreground">{item.tax_id}{item.tax_id_check?.status ? ` · ${t(`customer.tax_check.${item.tax_id_check.status}` as any)}` : ''}</span>{/if}
              <span class="text-muted-foreground">{lines(item.address)}</span>
            </div>
            <div class="flex shrink-0">
              {#if !item.is_default}<Button size="sm" variant="ghost" onclick={() => makeDefault(mode, item)}>{t('billing.make_default')}</Button>{/if}
              <Button size="icon-sm" variant="ghost" aria-label={t('common.edit')} onclick={() => edit(mode, item)}><PencilIcon /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')} onclick={() => remove(mode, item)}><Trash2Icon /></Button>
            </div>
          </div>
        {:else}
          <p class="text-muted-foreground text-sm">{t('billing.none')}</p>
        {/each}
      </section>
    {/each}
  </Card.Content>
</Card.Root>

{#if dialog}
  <BillingDetailsDialog bind:open mode={dialog.mode} title={dialog.mode === 'billing' ? (dialog.item ? t('billing.edit_profile') : t('billing.add_profile')) : dialog.item ? t('billing.edit_address') : t('billing.add_address')} initial={dialog.item ?? {}} {save} />
{/if}
