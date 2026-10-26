<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { api, qs, t, toast, notifyError, fieldErrors, download } from '#lib';

  /** The journal of booked entries for any accounting software (FR-INT-3), and the shop's account codes. */
  let { canManage }: { canManage: boolean } = $props();
  const KEYS = ['receivable', 'bank', 'cash', 'card_clearing', 'deposits', 'tax', 'revenue_rental', 'revenue_sale', 'revenue_fees', 'revenue_damage', 'revenue_other', 'discounts', 'rounding'] as const;
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
  let from = $state(day(-30));
  let until = $state(day(1));
  let accounts = $state<Record<string, string> | null>(null);
  let errors = $state<Record<string, string>>({});

  onMount(() => {
    api.get('/tenant/settings').then((s) => (accounts = { ...s.accounting.accounts }), notifyError);
  });
  const range = () => ({ from: new Date(`${from}T00:00:00Z`).toISOString(), to: new Date(`${until}T00:00:00Z`).toISOString() });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    try {
      await api.patch('/accounting/settings', { accounts });
      toast.success(t('common.saved'));
    } catch (err) {
      const fe = fieldErrors(err);
      errors = Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace('accounting.accounts.', ''), v]));
      if (!Object.keys(fe).length) notifyError(err);
    }
  }
</script>

<div class="flex max-w-5xl flex-col gap-6">
  <Card.Root data-testid="journal-export">
    <Card.Header><Card.Title>{t('journal.title')}</Card.Title><Card.Description>{t('accounting.journal_hint')}</Card.Description></Card.Header>
    <Card.Content class="flex flex-wrap items-end gap-3">
      <Field.Field class="w-40"><Field.Label for="jf">{t('inventory.from')}</Field.Label><Input id="jf" type="date" bind:value={from} /></Field.Field>
      <Field.Field class="w-40"><Field.Label for="jt">{t('inventory.until')}</Field.Label><Input id="jt" type="date" bind:value={until} /></Field.Field>
      <Button variant="outline" onclick={() => download(`/accounting/journal?${qs({ ...range(), format: 'csv' })}`).catch(notifyError)}><DownloadIcon />{t('reports.export_csv')}</Button>
      <Button variant="outline" onclick={() => download(`/accounting/journal?${qs({ ...range(), format: 'xlsx' })}`).catch(notifyError)}><DownloadIcon />{t('import.export_xlsx')}</Button>
    </Card.Content>
  </Card.Root>
  {#if canManage && accounts}
    <Card.Root>
      <Card.Header><Card.Title>{t('journal.accounts')}</Card.Title><Card.Description>{t('accounting.codes_hint')}</Card.Description></Card.Header>
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={save} novalidate>
          <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {#each KEYS as k (k)}
              <Field.Field data-invalid={!!errors[k] || undefined}>
                <Field.Label for={`acc-${k}`}>{t(`journal.account.${k}`)}</Field.Label>
                <Input id={`acc-${k}`} bind:value={accounts![k]} aria-invalid={!!errors[k]} />
                {#if errors[k]}<Field.Error>{errors[k]}</Field.Error>{/if}
              </Field.Field>
            {/each}
          </div>
          <div><Button type="submit" variant="outline">{t('common.save')}</Button></div>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
