<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Table from '@openrent/ui/table';
  import * as Collapsible from '@openrent/ui/collapsible';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import Columns3Icon from '@lucide/svelte/icons/columns-3';
  import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
  import { api, upload, download, t, toast, notifyError } from '#lib';
  import ImportReport from './import-report.svelte';

  type ImportEntity = 'products' | 'stock_items' | 'prices' | 'customers' | 'orders';
  /**
   * CSV/XLSX import: upload, read the dry-run report, map the file's own columns when they have other
   * names (kept for the next file like it, FR-MIG-2), then apply (FR-CAT-8).
   */
  let { entity, open = $bindable(false), onapplied }: { entity: ImportEntity; open?: boolean; onapplied?: () => void } = $props();
  let report = $state<any>(null);
  let busy = $state(false);
  let dragging = $state(false);
  let input: HTMLInputElement | undefined = $state();
  let columns = $state<{ key: string; required: boolean }[]>([]);
  let mapping = $state<Record<string, string>>({});
  let mapOpen = $state(false);

  $effect(() => {
    if (!open) report = null;
  });

  /** The column each header goes to now: the shop's choice, else what the import recognised, else none. */
  function current(r: any) {
    return Object.fromEntries((r.report.headers ?? []).map((h: string) => [h, r.mapping?.[h] ?? r.report.columns?.[h] ?? '']));
  }

  async function show(r: any) {
    report = r;
    mapping = current(r);
    if (!columns.length) columns = (await api.get(`/imports/columns/${entity}`)).data;
    // Columns it could not place, or a required one missing: show the mapping straight away.
    mapOpen = mapOpen || r.report.unknown_columns.length > 0 || r.report.file_errors.length > 0;
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    busy = true;
    try {
      const f = await upload('/files?purpose=import', file);
      await show(await api.post('/imports', { entity, file_id: f.id }));
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }

  async function remap() {
    busy = true;
    try {
      await show(await api.patch(`/imports/${report.id}`, { mapping }));
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }
  const label = (key: string) => t(`import.column.${key}` as any);

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
      <ImportReport {report} title={report.filename} />
      <Collapsible.Root bind:open={mapOpen}>
        <Collapsible.Trigger>{#snippet child({ props })}<Button variant="outline" size="sm" {...props}><Columns3Icon />{t('import.map_columns')}</Button>{/snippet}</Collapsible.Trigger>
        <Collapsible.Content class="mt-3 flex flex-col gap-3" data-testid="import-mapping">
          <p class="text-muted-foreground text-sm">{t('import.map_hint')}</p>
          <div class="max-h-72 overflow-y-auto rounded-lg border">
            <Table.Root>
              <Table.Header><Table.Row><Table.Head>{t('import.col.file_column')}</Table.Head><Table.Head>{t('import.col.openrent_column')}</Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {#each report.report.headers ?? [] as h (h)}
                  <Table.Row>
                    <Table.Cell class="font-mono text-xs">{h}</Table.Cell>
                    <Table.Cell>
                      <NativeSelect class="w-full" bind:value={mapping[h]} aria-label={t('import.map_column', { column: h })}>
                        <NativeSelectOption value="">{t('import.skip_column')}</NativeSelectOption>
                        {#each columns as c (c.key)}<NativeSelectOption value={c.key}>{label(c.key)}{c.required ? ' *' : ''}</NativeSelectOption>{/each}
                      </NativeSelect>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
          <div><Button size="sm" disabled={busy} onclick={remap}>{#if busy}<Spinner />{/if}{t('import.check_again')}</Button></div>
        </Collapsible.Content>
      </Collapsible.Root>
      {#if report.error_count}<p class="text-destructive text-sm">{t('import.fix_and_retry')}</p>{/if}
    {/if}

    <Dialog.Footer>
      {#if report}<Button variant="outline" onclick={() => (report = null)}><UploadIcon />{t('import.other_file')}</Button>{/if}
      <Button disabled={blocked || busy} onclick={apply} data-testid="import-apply">{#if busy && report}<Spinner />{/if}{t('import.apply')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
