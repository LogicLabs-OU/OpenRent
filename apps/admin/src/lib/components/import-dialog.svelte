<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { StatusBadge } from '@openrent/ui/openrent';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
  import { api, upload, download, t, toast, notifyError } from '#lib';

  /** CSV/XLSX import: upload, read the dry-run report, then apply (FR-CAT-8). */
  let { entity, open = $bindable(false), onapplied }: { entity: 'products' | 'stock_items' | 'prices'; open?: boolean; onapplied?: () => void } = $props();
  let report = $state<any>(null);
  let busy = $state(false);
  let dragging = $state(false);
  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (!open) report = null;
  });

  async function choose(file: File | undefined) {
    if (!file) return;
    busy = true;
    try {
      const f = await upload('/files?purpose=import', file);
      report = await api.post('/imports', { entity, file_id: f.id });
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }

  async function apply() {
    busy = true;
    try {
      const r = await api.post(`/imports/${report.id}/actions/apply`);
      toast.success(t('import.applied', { create: r.report.counts.create, update: r.report.counts.update }));
      open = false;
      onapplied?.();
    } catch (e) {
      notifyError(e);
      report = await api.get(`/imports/${report.id}`).catch(() => report);
    } finally {
      busy = false;
    }
  }

  const blocked = $derived(!report || report.error_count > 0 || report.report.counts.create + report.report.counts.update === 0);
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>{t(`import.title.${entity}`)}</Dialog.Title>
      <Dialog.Description>{t('import.hint')}</Dialog.Description>
    </Dialog.Header>

    {#if !report}
      <button
        type="button"
        class={['hover:bg-muted/50 flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm transition-colors', dragging && 'border-primary bg-primary/5']}
        onclick={() => input?.click()}
        ondragover={(e) => { e.preventDefault(); dragging = true; }}
        ondragleave={() => (dragging = false)}
        ondrop={(e) => { e.preventDefault(); dragging = false; choose(e.dataTransfer?.files[0]); }}
        disabled={busy}
      >
        {#if busy}<Spinner class="size-6" />{:else}<FileSpreadsheetIcon class="text-muted-foreground size-8" />{/if}
        <span class="font-medium">{t('import.choose')}</span>
        <span class="text-muted-foreground">{t('import.formats')}</span>
      </button>
      <input bind:this={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" data-testid="import-input" onchange={(e) => { choose((e.currentTarget as HTMLInputElement).files?.[0]); (e.currentTarget as HTMLInputElement).value = ''; }} />
      <div class="flex flex-wrap gap-2">
        <Button variant="link" size="sm" class="px-0" onclick={() => download(`/imports/templates/${entity}?format=xlsx`).catch(notifyError)}><DownloadIcon />{t('import.template_xlsx')}</Button>
        <Button variant="link" size="sm" class="px-0" onclick={() => download(`/imports/templates/${entity}?format=csv`).catch(notifyError)}><DownloadIcon />{t('import.template_csv')}</Button>
      </div>
    {:else}
      {@const r = report.report}
      <div class="flex flex-wrap items-center gap-2 text-sm" data-testid="import-summary">
        <span class="font-medium">{report.filename}</span>
        <Badge variant="secondary">{t('import.count.create', { count: r.counts.create })}</Badge>
        <Badge variant="secondary">{t('import.count.update', { count: r.counts.update })}</Badge>
        <Badge variant="outline">{t('import.count.unchanged', { count: r.counts.unchanged })}</Badge>
        {#if r.counts.error}<Badge variant="destructive">{t('import.count.error', { count: r.counts.error })}</Badge>{/if}
      </div>
      {#each r.file_errors as fe (fe)}
        <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{fe}</Alert.Title></Alert.Root>
      {/each}
      {#if r.unknown_columns.length}
        <p class="text-muted-foreground text-sm">{t('import.ignored_columns', { columns: r.unknown_columns.join(', ') })}</p>
      {/if}
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
      {#if report.error_count}<p class="text-destructive text-sm">{t('import.fix_and_retry')}</p>{/if}
    {/if}

    <Dialog.Footer>
      {#if report}<Button variant="outline" onclick={() => (report = null)}><UploadIcon />{t('import.other_file')}</Button>{/if}
      <Button disabled={blocked || busy} onclick={apply} data-testid="import-apply">{#if busy && report}<Spinner />{/if}{t('import.apply')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
