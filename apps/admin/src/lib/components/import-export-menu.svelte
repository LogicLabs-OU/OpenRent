<script lang="ts">
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { Button } from '@openrent/ui/button';
  import ArrowDownUpIcon from '@lucide/svelte/icons/arrow-down-up';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { download, t, notifyError } from '#lib';
  import ImportDialog from './import-dialog.svelte';

  type Entity = 'products' | 'stock_items' | 'prices' | 'customers' | 'orders';
  /** Import and export menu for one or more entities (products page: products and prices). */
  let { entities, onimported }: { entities: Entity[]; onimported?: () => void } = $props();
  let importing = $state<Entity | null>(null);
  let open = $state(false);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>{#snippet child({ props })}<Button variant="outline" {...props}><ArrowDownUpIcon />{t('import.menu')}</Button>{/snippet}</DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-60">
    {#each entities as e (e)}
      <DropdownMenu.Group>
        <DropdownMenu.Label>{t(`import.entity.${e}`)}</DropdownMenu.Label>
        <DropdownMenu.Item onSelect={() => { importing = e; open = true; }}><UploadIcon />{t('import.import')}</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => download(`/exports/${e}?format=xlsx`).catch(notifyError)}><DownloadIcon />{t('import.export_xlsx')}</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => download(`/exports/${e}?format=csv`).catch(notifyError)}><DownloadIcon />{t('import.export_csv')}</DropdownMenu.Item>
      </DropdownMenu.Group>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
{#if importing}<ImportDialog entity={importing} bind:open onapplied={onimported} />{/if}
