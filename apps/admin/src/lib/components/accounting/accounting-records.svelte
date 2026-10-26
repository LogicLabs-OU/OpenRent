<script lang="ts">
  import { onMount } from 'svelte';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import * as Dialog from '@openrent/ui/dialog';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { StatusBadge, formatMoney } from '@openrent/ui/openrent';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { api, qs, t, toast, notifyError, d } from '#lib';
  import { to } from '#lib/nav.ts';

  /** Every booked entry, whether it reached the accounting system, and the record it became there. */
  let { connection, canManage }: { connection: any; canManage: boolean } = $props();
  const KINDS = ['invoice', 'credit_note', 'invoice_void', 'payment', 'refund', 'deposit_received', 'deposit_returned', 'deposit_applied', 'damage_revenue'];
  const STATUSES = ['waiting', 'retrying', 'sent', 'failed', 'mismatch', 'manual', 'skipped', 'paused', 'before_sync'];
  const TONE: Record<string, string> = { sent: 'paid', failed: 'failed', retrying: 'pending', waiting: 'pending', manual: 'closed', skipped: 'draft', paused: 'draft', before_sync: 'draft', not_connected: 'draft' };
  const p = new URLSearchParams(location.search);
  let filter = $state({ kind: '', status: p.get('status') ?? '', from: '', to: '' });
  let rows = $state<any[] | null>(null);
  let handling = $state<any>(null);
  let note = $state('');

  async function load() {
    try {
      rows = (await api.get(`/accounting/records?${qs({ ...filter, limit: 200 })}`)).data;
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);

  async function resend(r: any) {
    try {
      await api.post(`/accounting/records/${r.entry_id}/actions/resend`, {});
      toast.success(t('accounting.resent'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
  async function markHandled(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api.post(`/accounting/records/${handling.entry_id}/actions/mark_handled`, { note: note || undefined });
      handling = null;
      note = '';
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      notifyError(err);
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-end gap-3">
    <Field.Field class="w-48"><Field.Label for="rec-kind">{t('accounting.kind')}</Field.Label>
      <NativeSelect.Root id="rec-kind" class="w-full" bind:value={filter.kind} onchange={load}><NativeSelect.Option value="">{t('integrations.all')}</NativeSelect.Option>{#each KINDS as k (k)}<NativeSelect.Option value={k}>{t(`accounting.kind.${k}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
    </Field.Field>
    <Field.Field class="w-48"><Field.Label for="rec-status">{t('accounting.status')}</Field.Label>
      <NativeSelect.Root id="rec-status" class="w-full" bind:value={filter.status} onchange={load}><NativeSelect.Option value="">{t('integrations.all')}</NativeSelect.Option>{#each STATUSES as s (s)}<NativeSelect.Option value={s}>{t(`accounting.record.${s}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
    </Field.Field>
    <Field.Field class="w-40"><Field.Label for="rec-from">{t('inventory.from')}</Field.Label><Input id="rec-from" type="date" bind:value={filter.from} onchange={load} /></Field.Field>
    <Field.Field class="w-40"><Field.Label for="rec-to">{t('inventory.until')}</Field.Label><Input id="rec-to" type="date" bind:value={filter.to} onchange={load} /></Field.Field>
  </div>

  <Table.Root data-testid="accounting-records">
    <Table.Header>
      <Table.Row>
        <Table.Head>{t('accounting.number')}</Table.Head><Table.Head>{t('accounting.date')}</Table.Head><Table.Head>{t('accounting.kind')}</Table.Head>
        <Table.Head>{t('accounting.reference')}</Table.Head><Table.Head class="text-right">{t('accounting.total')}</Table.Head><Table.Head>{t('accounting.status')}</Table.Head>
        <Table.Head>{connection?.provider_name ?? t('accounting.system')}</Table.Head><Table.Head><span class="sr-only">{t('accounting.actions')}</span></Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each rows ?? [] as r (r.entry_id)}
        <Table.Row data-testid="accounting-record" data-kind={r.kind}>
          <Table.Cell class="tabular-nums">{r.number}</Table.Cell>
          <Table.Cell>{d(r.entry_date)}</Table.Cell>
          <Table.Cell>{t(`accounting.kind.${r.kind}` as any)}</Table.Cell>
          <Table.Cell>{#if r.order_id}<a class="underline" href={to(`/orders/${r.order_id}`)}>{r.reference}</a>{:else}{r.reference}{/if}</Table.Cell>
          <Table.Cell class="text-right tabular-nums">{formatMoney({ amount: r.total, currency: r.currency })}</Table.Cell>
          <Table.Cell class="whitespace-normal">
            <StatusBadge status={TONE[r.status] ?? 'draft'} label={t(`accounting.record.${r.status}` as any)} />
            {#if r.message && r.status !== 'sent'}<p class="text-muted-foreground mt-1 max-w-xs text-xs">{r.message}</p>{/if}
          </Table.Cell>
          <Table.Cell class="whitespace-normal">
            {#if r.remote}
              <div class="flex items-center gap-1 text-xs">
                {#if r.remote.mismatch}<TriangleAlertIcon class="text-destructive size-4" aria-label={t('accounting.record.mismatch')} />{/if}
                {#if r.remote.url}<a class="inline-flex items-center gap-1 underline" href={r.remote.url} target="_blank" rel="noopener noreferrer">{r.remote.number ?? t('accounting.open_remote')}<ExternalLinkIcon class="size-3" /></a>{:else}<span class="font-mono">{r.remote.number ?? r.remote.id}</span>{/if}
              </div>
              {#if r.remote.mismatch}<p class="text-destructive text-xs">{t('accounting.mismatch_detail', { status: r.remote.status ?? '—', total: r.remote.total === null ? '—' : formatMoney({ amount: r.remote.total, currency: r.currency }) })}</p>{/if}
            {/if}
          </Table.Cell>
          <Table.Cell class="text-right">
            {#if canManage && connection && !['sent', 'manual', 'before_sync'].includes(r.status)}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>{#snippet child({ props })}<Button variant="ghost" size="icon" aria-label={t('accounting.actions_for', { number: r.number })} {...props}><EllipsisIcon /></Button>{/snippet}</DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  <DropdownMenu.Item onclick={() => resend(r)}>{t('accounting.resend')}</DropdownMenu.Item>
                  <DropdownMenu.Item onclick={() => (handling = r)}>{t('accounting.mark_handled')}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}
          </Table.Cell>
        </Table.Row>
      {:else}
        <Table.Row><Table.Cell colspan={8} class="text-muted-foreground">{rows ? t('accounting.no_records') : t('common.loading')}</Table.Cell></Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<Dialog.Root open={!!handling} onOpenChange={(v) => !v && (handling = null)}>
  <Dialog.Content>
    <form class="flex flex-col gap-4" onsubmit={markHandled}>
      <Dialog.Header><Dialog.Title>{t('accounting.mark_handled_title', { number: handling?.number ?? '' })}</Dialog.Title><Dialog.Description>{t('accounting.mark_handled_hint')}</Dialog.Description></Dialog.Header>
      <Field.Field><Field.Label for="mh-note">{t('accounting.note')}</Field.Label><Textarea id="mh-note" bind:value={note} maxlength={500} /></Field.Field>
      <Dialog.Footer><Button type="submit">{t('accounting.mark_handled')}</Button></Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
