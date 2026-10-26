<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import * as Field from '@openrent/ui/field';
  import { Button } from '@openrent/ui/button';
  import { Input } from '@openrent/ui/input';
  import { StatCard, StatusBadge, formatMoney } from '@openrent/ui/openrent';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { api, t, dt, notifyError } from '#lib';

  /** Where the books stand: the connected system, what is waiting or failed, and a month's booked totals. */
  let { overview, connection, canManage, onsetup, onrecords }: { overview: any; connection: any; canManage: boolean; onsetup: () => void; onrecords: (status: string) => void } = $props();
  // Another month replaces the page's own overview until the page reloads it.
  let picked = $state<any>(null);
  const data = $derived(picked ?? overview);
  let month = $state('');
  const TONE: Record<string, string> = { connected: 'paid', error: 'failed', pending: 'pending' };

  async function changeMonth() {
    try {
      picked = await api.get(`/accounting/overview?month=${month}`);
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<div class="flex flex-col gap-6">
  {#if !data.connection}
    <Card.Root data-testid="accounting-empty">
      <Card.Header><Card.Title>{t('accounting.none_title')}</Card.Title><Card.Description>{t('accounting.none_hint')}</Card.Description></Card.Header>
      {#if canManage}<Card.Footer><Button onclick={onsetup}>{t('accounting.set_up')}</Button></Card.Footer>{/if}
    </Card.Root>
  {:else}
    {#if data.connection.status === 'error'}
      <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{data.connection.last_error ?? t('accounting.needs_attention')}</Alert.Title>
        {#if canManage}<Alert.Description><Button variant="outline" size="sm" class="mt-2" onclick={onsetup}>{t('accounting.open_setup')}</Button></Alert.Description>{/if}
      </Alert.Root>
    {:else if !data.connection.sync_enabled}
      <Alert.Root><CircleAlertIcon /><Alert.Title>{t('accounting.not_sending')}</Alert.Title>
        {#if canManage}<Alert.Description><Button variant="outline" size="sm" class="mt-2" onclick={onsetup}>{t('accounting.open_setup')}</Button></Alert.Description>{/if}
      </Alert.Root>
    {/if}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="accounting-stats">
      <Card.Root>
        <Card.Header>
          <Card.Description>{t('accounting.system')}</Card.Description>
          <Card.Title class="flex items-center gap-2">{data.connection.provider_name}<StatusBadge status={TONE[data.connection.status]} label={t(`integrations.status.${data.connection.status}` as any)} /></Card.Title>
        </Card.Header>
        <Card.Content class="text-muted-foreground text-sm">
          <p>{data.connection.account_name ?? '—'}</p>
          <p>{data.connection.last_sync_at ? t('integrations.last_sync', { when: dt(data.connection.last_sync_at) }) : t('integrations.never_synced')}</p>
        </Card.Content>
      </Card.Root>
      <button type="button" class="text-left" onclick={() => onrecords('waiting')}><StatCard label={t('accounting.waiting')} value={String(data.counts?.waiting ?? 0)} hint={t('accounting.waiting_hint')} /></button>
      <button type="button" class="text-left" onclick={() => onrecords('failed')}><StatCard label={t('accounting.failed')} value={String(data.counts?.failed ?? 0)} hint={t('accounting.failed_hint')} /></button>
      <button type="button" class="text-left" onclick={() => onrecords('mismatch')}><StatCard label={t('accounting.mismatches')} value={String(data.counts?.mismatches ?? 0)} hint={t('accounting.mismatches_hint')} /></button>
    </div>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>{t('accounting.booked_title')}</Card.Title>
      <Card.Description>{t('accounting.booked_hint')}</Card.Description>
      <Card.Action>
        <Field.Field orientation="horizontal">
          <Field.Label for="acc-month" class="sr-only">{t('accounting.month')}</Field.Label>
          <Input id="acc-month" type="month" class="w-40" value={month || data.month} oninput={(e) => (month = (e.currentTarget as HTMLInputElement).value)} onchange={changeMonth} />
        </Field.Field>
      </Card.Action>
    </Card.Header>
    <Card.Content>
      <Table.Root data-testid="accounting-totals">
        <Table.Header><Table.Row><Table.Head>{t('accounting.kind')}</Table.Head><Table.Head class="text-right">{t('accounting.entries')}</Table.Head><Table.Head class="text-right">{t('accounting.total')}</Table.Head></Table.Row></Table.Header>
        <Table.Body>
          {#each data.totals as r (`${r.kind}:${r.currency}`)}
            <Table.Row><Table.Cell>{t(`accounting.kind.${r.kind}` as any)}</Table.Cell><Table.Cell class="text-right tabular-nums">{r.count}</Table.Cell><Table.Cell class="text-right tabular-nums">{formatMoney({ amount: r.total, currency: r.currency })}</Table.Cell></Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={3} class="text-muted-foreground">{t('accounting.nothing_booked')}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
      {#if data.unbooked}<p class="text-muted-foreground mt-3 text-sm">{t('accounting.unbooked', { count: data.unbooked })}</p>{/if}
    </Card.Content>
  </Card.Root>
</div>
