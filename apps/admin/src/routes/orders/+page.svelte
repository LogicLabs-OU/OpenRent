<script lang="ts">
  import UploadIcon from '@lucide/svelte/icons/upload';
  import ImportDialog from '#lib/components/import-dialog.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as Table from '@openrent/ui/table';
  import * as Tabs from '@openrent/ui/tabs';
  import * as Empty from '@openrent/ui/empty';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Button } from '@openrent/ui/button';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Kbd } from '@openrent/ui/kbd';
  import { StatusBadge, Money, PageHeader } from '@openrent/ui/openrent';
  import SearchIcon from '@lucide/svelte/icons/search';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
  import { api, d, qs, t, notifyError, session } from '#lib';
  import { to } from '#lib/nav.ts';

  const TABS = [
    { key: 'all', filter: '', label: 'orders.tab.all' },
    { key: 'drafts', filter: 'draft,quote', label: 'orders.tab.drafts' },
    { key: 'upcoming', filter: 'reserved,prepared', label: 'orders.tab.upcoming' },
    { key: 'out', filter: 'out,returned_partial', label: 'orders.tab.out' },
    { key: 'close', filter: 'returned,inspected', label: 'orders.tab.to_close' },
    { key: 'archive', filter: 'closed,cancelled,expired', label: 'orders.tab.archive' },
  ] as const;
  let tab = $state(page.url.searchParams.get('tab') ?? 'all');
  let q = $state(page.url.searchParams.get('q') ?? '');
  let rows = $state<any[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(true);
  let sel = $state(0);
  let timer: ReturnType<typeof setTimeout>;
  const filter = $derived(TABS.find((x) => x.key === tab)?.filter ?? '');

  async function load(append = false) {
    loading = true;
    try {
      const r = await api.get(`/orders?${qs({ 'filter[status]': filter, 'filter[location_id]': session.locationId || undefined, q, limit: 50, cursor: append ? cursor : undefined, sort: tab === 'upcoming' ? 'starts_at' : undefined })}`);
      rows = append ? [...rows, ...r.data] : r.data;
      cursor = r.next_cursor;
    } catch (e) {
      notifyError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void filter;
    void session.locationId;
    load();
  });

  function key(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.closest('[role="dialog"]')) return;
    if (e.key === 'j') sel = Math.min(sel + 1, rows.length - 1);
    else if (e.key === 'k') sel = Math.max(sel - 1, 0);
    else if (e.key === 'Enter' && rows[sel]) goto(to(`/orders/${rows[sel].id}`));
  }
  import CancellationRequests from '#lib/components/cancellation-requests.svelte';
  import ExtensionRequests from '#lib/components/extension-requests.svelte';
  import ListExportMenu from '#lib/components/list-export-menu.svelte';
  let importOpen = $state(false);
</script>

<svelte:window onkeydown={key} />
<svelte:head><title>{t('nav.orders')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.orders')} description={t('orders.description')}>
  {#snippet actions()}
    <ListExportMenu path="/orders/export" query={{ 'filter[status]': filter, q, sort: tab === 'upcoming' ? 'starts_at' : undefined }} />
    {#if session.can('orders:write')}<Button variant="outline" onclick={() => (importOpen = true)}><UploadIcon />{t('import.import')}</Button>{/if}
    <Button href={to('/orders/new')}><PlusIcon />{t('action.new_order')}</Button>
  {/snippet}
</PageHeader>
<ImportDialog entity="orders" bind:open={importOpen} onapplied={() => load()} />
<CancellationRequests />
<ExtensionRequests />

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <Tabs.Root bind:value={tab}>
    <Tabs.List class="flex-wrap">
      {#each TABS as x (x.key)}<Tabs.Trigger value={x.key}>{t(x.label)}</Tabs.Trigger>{/each}
    </Tabs.List>
  </Tabs.Root>
  <InputGroup.Root class="w-full sm:w-72">
    <InputGroup.Input placeholder={t('orders.search')} bind:value={q} oninput={() => { clearTimeout(timer); timer = setTimeout(() => load(), 200); }} aria-label={t('orders.search')} />
    <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
  </InputGroup.Root>
</div>

{#if loading && !rows.length}
  <div class="space-y-2">{#each Array(6) as _}<Skeleton class="h-10 w-full" />{/each}</div>
{:else if rows.length}
  <div class="overflow-hidden rounded-lg border">
    <Table.Root>
      <Table.Header class="bg-muted/50">
        <Table.Row>
          <Table.Head class="w-20">{t('orders.col.number')}</Table.Head>
          <Table.Head>{t('orders.col.customer')}</Table.Head>
          <Table.Head>{t('orders.col.pickup')}</Table.Head>
          <Table.Head>{t('orders.col.return')}</Table.Head>
          <Table.Head>{t('orders.col.status')}</Table.Head>
          <Table.Head>{t('orders.col.payment')}</Table.Head>
          <Table.Head class="text-right">{t('orders.col.total')}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as o, i (o.id)}
          <Table.Row class="cursor-pointer" data-state={i === sel ? 'selected' : undefined} onclick={() => goto(to(`/orders/${o.id}`))}>
            <Table.Cell class="font-mono text-xs"><a href={to(`/orders/${o.id}`)} class="hover:underline">#{o.number}</a></Table.Cell>
            <Table.Cell class="font-medium">{o.customer_name ?? '—'}{#if o.source === 'storefront'}<span class="ml-2 text-xs font-normal text-muted-foreground">{t('orders.online')}</span>{/if}</Table.Cell>
            <Table.Cell>{d(o.starts_at)}</Table.Cell>
            <Table.Cell>{d(o.ends_at)}</Table.Cell>
            <Table.Cell><StatusBadge status={o.status} label={t(`status.${o.status}` as any)} /></Table.Cell>
            <Table.Cell><StatusBadge status={o.payment_status} label={t(`status.${o.payment_status}` as any)} /></Table.Cell>
            <Table.Cell class="text-right"><Money value={o.totals.total} /></Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
  <div class="mt-3 flex items-center justify-between text-xs text-muted-foreground">
    <span class="flex items-center gap-1">{t('orders.keyboard')} <Kbd>J</Kbd><Kbd>K</Kbd><Kbd>{t('common.key_enter')}</Kbd></span>
    {#if cursor}<Button variant="outline" size="sm" disabled={loading} onclick={() => load(true)}>{t('common.load_more')}</Button>{/if}
  </div>
{:else}
  <Empty.Root class="border border-dashed">
    <Empty.Header>
      <Empty.Media variant="icon"><ClipboardListIcon /></Empty.Media>
      <Empty.Title>{t('orders.empty_title')}</Empty.Title>
      <Empty.Description>{t('orders.empty_description')}</Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href={to('/orders/new')}><PlusIcon />{t('action.new_order')}</Button></Empty.Content>
  </Empty.Root>
{/if}
