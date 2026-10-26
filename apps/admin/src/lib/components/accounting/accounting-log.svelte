<script lang="ts">
  import { onMount } from 'svelte';
  import * as Table from '@openrent/ui/table';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { StatusBadge } from '@openrent/ui/openrent';
  import { api, qs, t, toast, notifyError, dt } from '#lib';

  /** The sync log: each attempt to send an entry, newest first, with retry. */
  let { connection, canManage }: { connection: any; canManage: boolean } = $props();
  const TONE: Record<string, string> = { done: 'paid', skipped: 'draft', failed: 'failed', running: 'pending', pending: 'pending' };
  let filter = $state('');
  let tasks = $state<any[]>([]);

  async function load() {
    if (!connection) return;
    try {
      tasks = (await api.get(`/accounting/connection/tasks?${qs({ status: filter || undefined })}`)).data;
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);
  async function retry(id: string) {
    try {
      await api.post(`/accounting/tasks/${id}/actions/retry`, {});
      toast.success(t('integrations.retrying'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

{#if !connection}
  <p class="text-muted-foreground text-sm">{t('accounting.none_hint')}</p>
{:else}
  <div class="flex flex-col gap-3">
    <div class="flex justify-end">
      <NativeSelect.Root size="sm" bind:value={filter} onchange={load} aria-label={t('integrations.log_filter')}>
        <NativeSelect.Option value="">{t('integrations.all')}</NativeSelect.Option>
        {#each ['pending', 'done', 'skipped', 'failed'] as s (s)}<NativeSelect.Option value={s}>{t(`integrations.task.${s}` as any)}</NativeSelect.Option>{/each}
      </NativeSelect.Root>
    </div>
    <Table.Root data-testid="accounting-log">
      <Table.Body>
        {#each tasks as tk (tk.id)}
          <Table.Row>
            <Table.Cell class="text-xs"><div class="font-mono">{tk.event}</div><div class="text-muted-foreground">{dt(tk.created_at)}</div></Table.Cell>
            <Table.Cell class="text-xs whitespace-normal">{tk.message ?? ''}{#if tk.attempts > 1} <Badge variant="outline">{t('integrations.attempts', { count: tk.attempts })}</Badge>{/if}</Table.Cell>
            <Table.Cell class="text-right">
              <StatusBadge status={TONE[tk.status]} label={t(`integrations.task.${tk.status}` as any)} />
              {#if canManage && (tk.status === 'failed' || (tk.status === 'pending' && tk.attempts > 0))}<Button size="sm" variant="ghost" onclick={() => retry(tk.id)}>{t('integrations.retry')}</Button>{/if}
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell class="text-muted-foreground">{t('integrations.log_empty')}</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}
