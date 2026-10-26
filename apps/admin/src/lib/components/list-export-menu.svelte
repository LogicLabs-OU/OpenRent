<script lang="ts">
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { Button } from '@openrent/ui/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { download, qs, t, notifyError } from '#lib';

  /** Downloads a list with its current filters and search as CSV or XLSX (FR-INT-2). */
  let { path, query = {} }: { path: string; query?: Record<string, unknown> } = $props();
  const get = (format: 'csv' | 'xlsx') => download(`${path}?${qs({ ...query, format })}`).catch(notifyError);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>{#snippet child({ props })}<Button variant="outline" {...props} data-testid="list-export"><DownloadIcon />{t('import.export')}</Button>{/snippet}</DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item onSelect={() => get('xlsx')}><DownloadIcon />{t('import.export_xlsx')}</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => get('csv')}><DownloadIcon />{t('import.export_csv')}</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
