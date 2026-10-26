<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Progress } from '@openrent/ui/progress';
  import { Spinner } from '@openrent/ui/spinner';
  import ArchiveIcon from '@lucide/svelte/icons/archive';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { api, t, notifyError, download, dt } from '#lib';

  /** Settings → "Export all data" (FR-MIG-1): a ZIP with every table, document and file, built by the worker. */
  let exportsList = $state<any[]>([]);
  let starting = $state(false);
  let loaded = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = $derived(exportsList.find((j) => j.status === 'queued' || j.status === 'running') ?? null);

  async function load() {
    exportsList = (await api.get('/jobs?kind=tenant_export&limit=5')).data;
    loaded = true;
    clearTimeout(timer);
    if (active) timer = setTimeout(() => load().catch(() => undefined), 2000);
  }
  onMount(() => {
    load().catch(notifyError);
    return () => clearTimeout(timer);
  });

  async function start() {
    starting = true;
    try {
      await api.post('/tenant/export', {});
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      starting = false;
    }
  }

  const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
</script>

<Card.Root data-testid="data-export" data-loaded={loaded || undefined}>
  <Card.Header>
    <Card.Title>{t('export.title')}</Card.Title>
    <Card.Description>{t('export.hint')}</Card.Description>
    <Card.Action>
      <Button variant="outline" onclick={start} disabled={!loaded || starting || !!active}>{#if starting}<Spinner />{:else}<ArchiveIcon />{/if}{t('export.start')}</Button>
    </Card.Action>
  </Card.Header>
  {#if exportsList.length}
    <Card.Content class="flex flex-col gap-4">
      {#if active}
        <div class="flex flex-col gap-2" role="status">
          <span class="text-sm">{active.status === 'queued' ? t('export.queued') : t('export.running', { progress: active.progress })}</span>
          <Progress value={active.progress} max={100} aria-label={t('export.title')} />
        </div>
      {/if}
      <Table.Root>
        <Table.Body>
          {#each exportsList as j (j.id)}
            <Table.Row data-testid="data-export-row">
              <Table.Cell>{dt(j.created_at)}</Table.Cell>
              <Table.Cell><Badge variant={j.status === 'failed' ? 'destructive' : j.status === 'succeeded' ? 'secondary' : 'outline'}>{t(`export.status.${j.status}` as any)}</Badge></Table.Cell>
              <Table.Cell class="text-muted-foreground text-sm">{j.status === 'failed' ? (j.error ?? '') : j.result ? size(j.result.size) : ''}</Table.Cell>
              <Table.Cell class="text-right">
                {#if j.status === 'succeeded'}<Button size="sm" variant="ghost" onclick={() => download(`/jobs/${j.id}/download`).catch(notifyError)}><DownloadIcon />{t('export.download')}</Button>{/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  {/if}
</Card.Root>
