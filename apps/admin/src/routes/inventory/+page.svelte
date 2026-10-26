<script lang="ts">
  import { page } from '$app/state';
  import * as Table from '@openrent/ui/table';
  import * as Tabs from '@openrent/ui/tabs';
  import * as InputGroup from '@openrent/ui/input-group';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Button } from '@openrent/ui/button';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { StatusBadge, PageHeader } from '@openrent/ui/openrent';
  import SearchIcon from '@lucide/svelte/icons/search';
  import PrinterIcon from '@lucide/svelte/icons/printer';
  import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
  import { api, qs, t, toast, notifyError, openHtml, dt, session } from '#lib';
  import { to } from '#lib/nav.ts';
  import ImportExportMenu from '#lib/components/import-export-menu.svelte';

  const STATUSES = ['available', 'out', 'in_transit', 'needs_inspection', 'soft_down', 'hard_down', 'retired', 'lost'];
  /** Set by orders and transfers, never by hand. */
  const AUTOMATIC = ['out', 'in_transit'];
  const locationName = (id: string) => session.locations.find((l) => l.id === id)?.name ?? '';
  let tab = $state(page.url.searchParams.get('tab') ?? 'units');
  let q = $state(page.url.searchParams.get('q') ?? '');
  let status = $state('');
  let units = $state<any[]>([]);
  let levels = $state<any[]>([]);
  let downtimes = $state<any[]>([]);
  let selected = $state<Set<string>>(new Set());
  let timer: ReturnType<typeof setTimeout>;

  async function load() {
    try {
      const location_id = session.locationId || undefined;
      if (tab === 'units') units = (await api.get(`/stock_items?${qs({ q, 'filter[status]': status, 'filter[location_id]': location_id, limit: 200 })}`)).data;
      if (tab === 'bulk') levels = (await api.get(`/stock_levels?${qs({ location_id })}`)).data;
      if (tab === 'downtime') downtimes = (await api.get(`/downtimes?${qs({ active: true, location_id })}`)).data;
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    void tab;
    void status;
    void session.locationId;
    load();
  });

  async function setStatus(u: any, s: string) {
    try {
      const r = await api.post(`/stock_items/${u.id}/actions/set_status`, { status: s, reason: t('inventory.status_reason_admin') });
      if (r.unassigned_from_orders?.length) toast.info(t('inventory.unassigned_from', { orders: r.unassigned_from_orders.map((n: number) => '#' + n).join(', ') }));
      load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<svelte:head><title>{t('nav.inventory')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.inventory')} description={t('inventory.description')}>
  {#snippet actions()}
    {#if !session.singleLocation}<Button variant="outline" href={to('/inventory/transfers')}><ArrowLeftRightIcon />{t('transfers.title')}</Button>{/if}
    <ImportExportMenu entities={['stock_items']} onimported={load} />
    {#if tab === 'units'}<Button variant="outline" disabled={!selected.size} onclick={() => openHtml('/labels/batch', { stock_item_ids: [...selected], format: 'html' }).catch(notifyError)}><PrinterIcon />{t('inventory.print_labels', { count: selected.size })}</Button>{/if}
  {/snippet}
</PageHeader>

<Tabs.Root bind:value={tab}>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <Tabs.List>
      <Tabs.Trigger value="units">{t('inventory.tab.units')}</Tabs.Trigger>
      <Tabs.Trigger value="bulk">{t('inventory.tab.bulk')}</Tabs.Trigger>
      <Tabs.Trigger value="downtime">{t('inventory.tab.downtime')}</Tabs.Trigger>
    </Tabs.List>
    {#if tab === 'units'}
      <div class="flex flex-wrap gap-2">
        <NativeSelect.Root bind:value={status} aria-label={t('orders.col.status')}><NativeSelect.Option value="">{t('inventory.all_statuses')}</NativeSelect.Option>{#each STATUSES as s}<NativeSelect.Option value={s}>{t(`status.${s}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
        <InputGroup.Root class="w-64">
          <InputGroup.Input placeholder={t('inventory.search')} bind:value={q} oninput={() => { clearTimeout(timer); timer = setTimeout(load, 200); }} aria-label={t('inventory.search')} />
          <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
        </InputGroup.Root>
      </div>
    {/if}
  </div>
  <Tabs.Content value="units">
    <div class="overflow-hidden rounded-lg border">
      <Table.Root>
        <Table.Header class="bg-muted/50">
          <Table.Row>
            <Table.Head class="w-10"><Checkbox checked={units.length > 0 && units.every((u) => selected.has(u.id))} onCheckedChange={(c) => (selected = c ? new Set(units.map((u) => u.id)) : new Set())} aria-label={t('common.select_all')} /></Table.Head>
            <Table.Head>{t('inventory.barcode')}</Table.Head><Table.Head>{t('nav.products')}</Table.Head><Table.Head>{t('inventory.serial')}</Table.Head><Table.Head>{t('inventory.condition')}</Table.Head>{#if !session.singleLocation}<Table.Head>{t('field.location')}</Table.Head>{/if}<Table.Head>{t('orders.col.status')}</Table.Head><Table.Head class="w-44"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each units as u (u.id)}
            <Table.Row data-state={selected.has(u.id) ? 'selected' : undefined}>
              <Table.Cell><Checkbox checked={selected.has(u.id)} onCheckedChange={(c) => { const s = new Set(selected); c ? s.add(u.id) : s.delete(u.id); selected = s; }} aria-label={t('common.select_item', { name: u.barcode })} /></Table.Cell>
              <Table.Cell class="font-mono text-xs"><a class="hover:underline" href={to(`/inventory/units/${u.id}`)}>{u.barcode}</a></Table.Cell>
              <Table.Cell class="font-medium">{u.product_name}{u.variant_name !== u.product_name ? ` – ${u.variant_name}` : ''}</Table.Cell>
              <Table.Cell>{u.serial ?? ''}</Table.Cell>
              <Table.Cell>{u.condition}</Table.Cell>
              {#if !session.singleLocation}<Table.Cell>{locationName(u.location_id)}</Table.Cell>{/if}
              <Table.Cell><StatusBadge status={u.status} label={t(`status.${u.status}` as any)} /></Table.Cell>
              <Table.Cell>
                {#if !AUTOMATIC.includes(u.status)}
                <NativeSelect.Root size="sm" value="" onchange={(e) => { const s = (e.target as HTMLSelectElement).value; if (s) setStatus(u, s); }} aria-label={t('inventory.set_status')}>
                  <NativeSelect.Option value="">{t('inventory.set_status')}</NativeSelect.Option>
                  {#each STATUSES.filter((s) => !AUTOMATIC.includes(s)) as s}<NativeSelect.Option value={s}>{t(`status.${s}` as any)}</NativeSelect.Option>{/each}
                </NativeSelect.Root>
                {/if}
              </Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={session.singleLocation ? 7 : 8} class="h-24 text-center text-muted-foreground">{t('inventory.units_empty')}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </Tabs.Content>
  <Tabs.Content value="bulk">
    <div class="overflow-hidden rounded-lg border">
      <Table.Root>
        <Table.Header class="bg-muted/50"><Table.Row><Table.Head>{t('nav.products')}</Table.Head>{#if !session.singleLocation}<Table.Head>{t('field.location')}</Table.Head>{/if}<Table.Head>{t('inventory.barcode')}</Table.Head><Table.Head class="text-right">{t('field.quantity')}</Table.Head></Table.Row></Table.Header>
        <Table.Body>
          {#each levels as l (l.variant_id + l.location_id)}
            <Table.Row><Table.Cell class="font-medium">{l.product_name}{l.variant_name !== l.product_name ? ` – ${l.variant_name}` : ''}</Table.Cell>{#if !session.singleLocation}<Table.Cell>{locationName(l.location_id)}</Table.Cell>{/if}<Table.Cell class="font-mono text-xs">{l.barcode ?? ''}</Table.Cell><Table.Cell class="text-right tabular-nums">{l.quantity}</Table.Cell></Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={session.singleLocation ? 3 : 4} class="h-24 text-center text-muted-foreground">{t('inventory.bulk_empty')}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </Tabs.Content>
  <Tabs.Content value="downtime">
    <div class="overflow-hidden rounded-lg border">
      <Table.Root>
        <Table.Header class="bg-muted/50"><Table.Row><Table.Head>{t('inventory.unit_or_variant')}</Table.Head><Table.Head>{t('field.quantity')}</Table.Head><Table.Head>{t('inventory.from')}</Table.Head><Table.Head>{t('inventory.until')}</Table.Head><Table.Head>{t('cancel.reason')}</Table.Head><Table.Head></Table.Head></Table.Row></Table.Header>
        <Table.Body>
          {#each downtimes as dw (dw.id)}
            <Table.Row>
              <Table.Cell class="font-mono text-xs">{dw.stock_item_id ?? dw.variant_id}</Table.Cell><Table.Cell>{dw.quantity}</Table.Cell><Table.Cell>{dt(dw.starts_at)}</Table.Cell><Table.Cell>{dw.ends_at ? dt(dw.ends_at) : t('inventory.open_ended')}</Table.Cell><Table.Cell>{dw.reason}</Table.Cell>
              <Table.Cell class="text-right"><Button variant="ghost" size="sm" onclick={() => api.del(`/downtimes/${dw.id}`).then(load, notifyError)}>{t('inventory.end_now')}</Button></Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">{t('inventory.downtime_empty')}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </Tabs.Content>
</Tabs.Root>
<a class="sr-only" href={to('/products')}>{t('nav.products')}</a>
