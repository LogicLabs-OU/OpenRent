<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import { Input } from '@openrent/ui/input';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import PaperclipIcon from '@lucide/svelte/icons/paperclip';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { api, upload, download, t, toast, notifyError, confirmAction, getLocale } from '#lib';

  /**
   * Files on an order, a customer or a unit (FR-OR-13). On orders, "Customer can see" shares a file in
   * the customer's account and on the order page.
   */
  let { ownerPath, shareable = false }: { ownerPath: string; shareable?: boolean } = $props();
  const ACCEPT = '.pdf,image/*,.txt,.csv,.doc,.docx,.xls,.xlsx,.odt,.ods';
  let items = $state<any[]>([]);
  let busy = $state(false);
  let input: HTMLInputElement | undefined = $state();

  async function load() {
    items = (await api.get(`${ownerPath}/attachments`)).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  async function add(files: FileList | null) {
    if (!files?.length) return;
    busy = true;
    try {
      for (const file of Array.from(files)) {
        const f = await upload('/files?purpose=attachment', file);
        await api.post(`${ownerPath}/attachments`, { file_id: f.id, label: file.name });
      }
      toast.success(t('attachments.added'));
      await load();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }

  async function patch(a: any, body: Record<string, unknown>) {
    try {
      Object.assign(a, await api.patch(`${ownerPath}/attachments/${a.id}`, body));
    } catch (e) {
      notifyError(e);
      await load();
    }
  }

  async function remove(a: any) {
    if (!(await confirmAction({ title: t('attachments.remove_title', { name: a.label }), description: t('attachments.remove_description'), confirmLabel: t('common.remove'), destructive: true }))) return;
    try {
      await api.del(`${ownerPath}/attachments/${a.id}`);
      toast.success(t('attachments.removed'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  const size = (n: number) => new Intl.NumberFormat(getLocale(), { style: 'unit', unit: n >= 1048576 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1 }).format(n >= 1048576 ? n / 1048576 : Math.max(1, n / 1024));
</script>

<Card.Root data-testid="attachments">
  <Card.Header>
    <Card.Title>{t('attachments.title')}</Card.Title>
    <Card.Description>{shareable ? t('attachments.hint_shareable') : t('attachments.hint')}</Card.Description>
    <Card.Action>
      <Button size="sm" variant="outline" disabled={busy} onclick={() => input?.click()}>{#if busy}<Spinner />{:else}<PaperclipIcon />{/if}{t('attachments.add')}</Button>
      <input bind:this={input} type="file" multiple accept={ACCEPT} class="hidden" data-testid="attachment-input" onchange={(e) => { add((e.currentTarget as HTMLInputElement).files); (e.currentTarget as HTMLInputElement).value = ''; }} />
    </Card.Action>
  </Card.Header>
  <Card.Content>
    {#if items.length}
      <Table.Root>
        <Table.Body>
          {#each items as a (a.id)}
            <Table.Row>
              <Table.Cell class="w-full">
                <Input class="h-8" value={a.label} aria-label={t('attachments.label')} onchange={(e) => patch(a, { label: (e.currentTarget as HTMLInputElement).value })} />
                <div class="text-muted-foreground mt-1 text-xs">{a.filename} · {size(a.size)}</div>
              </Table.Cell>
              {#if shareable}
                <Table.Cell>
                  <label class="flex items-center gap-2 text-xs whitespace-nowrap">
                    <Switch checked={a.visibility === 'customer'} onCheckedChange={(v) => patch(a, { visibility: v ? 'customer' : 'internal' })} />{t('attachments.customer_can_see')}
                  </label>
                </Table.Cell>
              {/if}
              <Table.Cell class="text-right whitespace-nowrap">
                <Button variant="ghost" size="icon-sm" aria-label={t('attachments.download', { name: a.label })} onclick={() => download(`${ownerPath}/attachments/${a.id}/content`).catch(notifyError)}><DownloadIcon /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('attachments.remove_title', { name: a.label })} onclick={() => remove(a)}><TrashIcon /></Button>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      <Empty.Root class="p-6"><Empty.Description>{t('attachments.empty')}</Empty.Description></Empty.Root>
    {/if}
  </Card.Content>
</Card.Root>
