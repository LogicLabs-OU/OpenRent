<script lang="ts">
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import { Badge } from '@openrent/ui/badge';
  import { StatusBadge } from '@openrent/ui/openrent';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { t } from '#lib';

  /** What an import would do, row by row: counts, file problems and each row's result (FR-CAT-8). */
  let { report, title }: { report: any; title: string } = $props();
  const r = $derived(report.report);
</script>

<div class="flex flex-wrap items-center gap-2 text-sm" data-testid="import-summary">
  <span class="font-medium">{title}</span>
  <Badge variant="secondary">{t('import.count.create', { count: r.counts.create })}</Badge>
  <Badge variant="secondary">{t('import.count.update', { count: r.counts.update })}</Badge>
  <Badge variant="outline">{t('import.count.unchanged', { count: r.counts.unchanged })}</Badge>
  {#if r.counts.error}<Badge variant="destructive">{t('import.count.error', { count: r.counts.error })}</Badge>{/if}
</div>
{#each r.file_errors as fe (fe)}
  <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{fe}</Alert.Title></Alert.Root>
{/each}
{#if r.rows.length}
  <div class="max-h-80 overflow-y-auto rounded-lg border">
    <Table.Root>
      <Table.Header><Table.Row><Table.Head class="w-16">{t('import.col.row')}</Table.Head><Table.Head>{t('import.col.item')}</Table.Head><Table.Head>{t('import.col.result')}</Table.Head></Table.Row></Table.Header>
      <Table.Body>
        {#each r.rows as row (row.row)}
          <Table.Row>
            <Table.Cell class="tabular-nums">{row.row}</Table.Cell>
            <Table.Cell class="font-mono text-xs">{row.key}</Table.Cell>
            <Table.Cell class="whitespace-normal">
              {#if row.errors.length}
                <ul class="text-destructive text-xs">{#each row.errors as e, i (i)}<li><span class="font-mono">{e.field}</span>: {e.message}</li>{/each}</ul>
              {:else}
                <StatusBadge status={row.action === 'create' ? 'available' : 'pending'} label={t(`import.action.${row.action as 'create' | 'update'}`)} />
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}
