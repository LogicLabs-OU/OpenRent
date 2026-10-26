<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import * as Table from '@openrent/ui/table';
  import * as Tabs from '@openrent/ui/tabs';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { StatusBadge, PageHeader } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import XIcon from '@lucide/svelte/icons/x';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { api, qs, t, toast, notifyError, fieldErrors, confirmAction, session, dt, toLocalInput, fromLocalInput } from '#lib';
  import { to } from '#lib/nav.ts';

  /**
   * Stock transfers between locations (FR-LOC-2): plan what moves, send it, and book in what arrives.
   * A planned transfer holds its stock at the source from the day it ships.
   */
  const TABS = [
    { key: 'open', status: 'planned,in_transit' },
    { key: 'received', status: 'received' },
    { key: 'cancelled', status: 'cancelled' },
  ] as const;
  let tab = $state<string>(page.url.searchParams.get('tab') ?? 'open');
  let rows = $state<any[] | null>(null);
  let open = $state<any>(null);
  let arrived = $state<Record<string, number>>({});
  let busy = $state(false);
  let errors = $state<Record<string, string>>({});
  const canEdit = $derived(session.can('inventory:write'));

  type Line = { barcode?: string; variant_id?: string; name: string; quantity: number };
  let form = $state<{ from: string; to: string; ships_at: string; eta: string; notes: string; lines: Line[] } | null>(null);
  let code = $state('');
  let query = $state('');
  let results = $state<{ id: string; name: string }[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load() {
    try {
      rows = (await api.get(`/transfers?${qs({ status: TABS.find((x) => x.key === tab)?.status, location_id: session.locationId || undefined })}`)).data;
      if (open) show(rows!.find((r) => r.id === open.id) ?? (await api.get(`/transfers/${open.id}`)));
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    void tab;
    void session.locationId;
    load();
  });

  function show(tr: any) {
    open = tr;
    errors = {};
    arrived = Object.fromEntries(tr.lines.map((l: any) => [l.id, l.outstanding]));
  }

  const name = (l: any) => `${l.product_name}${l.variant_name && l.variant_name !== l.product_name ? ` – ${l.variant_name}` : ''}`;
  const summary = (tr: any) => tr.lines.map((l: any) => (l.barcode ? l.barcode : `${l.quantity} × ${name(l)}`)).join(', ');

  /** A new transfer; the order page's "transfer here" shortcut fills in where from, where to and what. */
  function create(prefill?: { get(key: string): string | null }) {
    const from = prefill?.get('from') || session.locationId || session.locations.find((l) => l.is_default)?.id || session.locations[0]?.id || '';
    const dest = prefill?.get('to') || (session.locations.find((l) => l.id !== from)?.id ?? '');
    const eta = prefill?.get('eta');
    const variant = prefill?.get('variant_id');
    const lines: Line[] = variant ? [{ variant_id: variant, name: prefill?.get('name') ?? '', quantity: Number(prefill?.get('quantity') ?? 1) }] : [];
    form = { from, to: dest, ships_at: toLocalInput(new Date()), eta: eta ? toLocalInput(eta) : '', notes: '', lines };
    errors = {};
    code = '';
    query = '';
    results = [];
  }

  function addUnit(e: SubmitEvent | KeyboardEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c || !form) return;
    if (!form.lines.some((l) => l.barcode === c)) form.lines = [...form.lines, { barcode: c, name: c, quantity: 1 }];
    code = '';
  }

  function search() {
    clearTimeout(timer);
    const q = query.trim();
    if (!q) return void (results = []);
    timer = setTimeout(async () => {
      try {
        const products = (await api.get(`/products?${qs({ q, limit: 8 })}`)).data;
        results = products.flatMap((p: any) => (p.variants ?? []).filter((v: any) => v.tracking === 'bulk').map((v: any) => ({ id: v.id, name: v.name && v.name !== p.name ? `${p.name} – ${v.name}` : p.name })));
      } catch (err) {
        notifyError(err);
      }
    }, 200);
  }

  function addBulk(v: { id: string; name: string }) {
    if (!form) return;
    if (!form.lines.some((l) => l.variant_id === v.id)) form.lines = [...form.lines, { variant_id: v.id, name: v.name, quantity: 1 }];
    query = '';
    results = [];
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    busy = true;
    errors = {};
    try {
      const f = form;
      const tr = await api.post('/transfers', {
        from_location_id: f.from, to_location_id: f.to, ships_at: fromLocalInput(f.ships_at), eta: f.eta ? fromLocalInput(f.eta) : null, notes: f.notes,
        lines: f.lines.map((l) => (l.barcode ? { barcode: l.barcode } : { variant_id: l.variant_id, quantity: Number(l.quantity) })),
      });
      toast.success(t('transfers.created', { number: tr.number }));
      form = null;
      tab = 'open';
      await load();
      show(tr);
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function act(action: 'dispatch' | 'cancel', done: string) {
    if (action === 'cancel' && !(await confirmAction({ title: t('transfers.cancel_title', { number: open.number }), description: t('transfers.cancel_description'), confirmLabel: t('transfers.cancel'), destructive: true }))) return;
    busy = true;
    try {
      show(await api.post(`/transfers/${open.id}/actions/${action}`, {}));
      toast.success(done);
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function receive(complete: boolean) {
    const missing = open.lines.reduce((n: number, l: any) => n + l.outstanding - Number(arrived[l.id] ?? 0), 0);
    if (complete && missing > 0 && !(await confirmAction({ title: t('transfers.close_title'), description: t('transfers.close_description', { count: missing }), confirmLabel: t('transfers.close'), destructive: true }))) return;
    busy = true;
    errors = {};
    try {
      const lines = open.lines.filter((l: any) => l.outstanding > 0).map((l: any) => ({ line_id: l.id, quantity: Number(arrived[l.id] ?? 0) }));
      const tr = await api.post(`/transfers/${open.id}/actions/receive`, { lines, complete });
      show(tr);
      toast.success(tr.status === 'received' ? t('transfers.received', { number: tr.number }) : t('transfers.partly_received'));
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }
  /** A line's error from the receive call, by its position among the lines still on the way. */
  onMount(() => {
    if (page.url.searchParams.get('new') && canEdit && !session.singleLocation) create(page.url.searchParams);
  });
  const receiveError = (line: any) => errors[`lines[${open.lines.filter((l: any) => l.outstanding > 0).indexOf(line)}].quantity`];
</script>

<svelte:head><title>{t('transfers.title')} · OpenRent</title></svelte:head>

<PageHeader title={t('transfers.title')} description={t('transfers.description')}>
  {#snippet actions()}
    <Button variant="outline" href={to('/inventory')}>{t('nav.inventory')}</Button>
    {#if canEdit && !session.singleLocation}<Button onclick={() => create()}><PlusIcon />{t('transfers.new')}</Button>{/if}
  {/snippet}
</PageHeader>

{#if session.singleLocation}
  <p class="text-muted-foreground mb-4 text-sm">{t('transfers.single_location')}</p>
{/if}

<Tabs.Root bind:value={tab}>
  <Tabs.List class="mb-4">
    {#each TABS as x (x.key)}<Tabs.Trigger value={x.key}>{t(`transfers.tab.${x.key}`)}</Tabs.Trigger>{/each}
  </Tabs.List>
</Tabs.Root>

<div class="overflow-hidden rounded-lg border">
  <Table.Root>
    <Table.Header class="bg-muted/50">
      <Table.Row>
        <Table.Head class="w-16">#</Table.Head><Table.Head>{t('transfers.route')}</Table.Head><Table.Head>{t('transfers.ships_at')}</Table.Head><Table.Head>{t('transfers.eta')}</Table.Head><Table.Head>{t('transfers.stock')}</Table.Head><Table.Head>{t('orders.col.status')}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each rows ?? [] as tr (tr.id)}
        <Table.Row class="cursor-pointer" data-testid="transfer-row" onclick={() => show(tr)}>
          <Table.Cell class="font-medium tabular-nums">#{tr.number}</Table.Cell>
          <Table.Cell><span class="inline-flex items-center gap-1.5">{tr.from_location_name}<ArrowRightIcon class="size-3.5 text-muted-foreground" aria-label={t('transfers.to')} />{tr.to_location_name}</span></Table.Cell>
          <Table.Cell>{dt(tr.dispatched_at ?? tr.ships_at)}</Table.Cell>
          <Table.Cell>{tr.eta ? dt(tr.eta) : ''}</Table.Cell>
          <Table.Cell class="max-w-64 truncate">{summary(tr)}</Table.Cell>
          <Table.Cell><StatusBadge status={tr.status} label={t(`transfers.status.${tr.status}` as any)} /></Table.Cell>
        </Table.Row>
      {:else}
        <Table.Row><Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">{rows ? t('transfers.empty') : t('common.loading')}</Table.Cell></Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<!-- One transfer: its lines and the next step. -->
<Sheet.Root open={!!open} onOpenChange={(v) => !v && (open = null)}>
  <Sheet.Content class="overflow-y-auto sm:max-w-lg">
    {#if open}
      <div class="flex flex-col gap-4 p-4" data-testid="transfer-sheet">
        <Sheet.Header class="p-0">
          <Sheet.Title>{t('transfers.heading', { number: open.number })}</Sheet.Title>
          <Sheet.Description>{open.from_location_name} → {open.to_location_name}</Sheet.Description>
        </Sheet.Header>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={open.status} label={t(`transfers.status.${open.status}` as any)} />
          <span class="text-muted-foreground">{t('transfers.ships_at')}: {dt(open.dispatched_at ?? open.ships_at)}{#if open.eta} · {t('transfers.eta')}: {dt(open.eta)}{/if}</span>
        </div>
        {#if open.notes}<p class="text-sm whitespace-pre-line">{open.notes}</p>{/if}
        <ul class="flex flex-col divide-y rounded-md border text-sm">
          {#each open.lines as l (l.id)}
            <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="transfer-line">
              <span>
                <span class="font-medium">{name(l)}</span>
                {#if l.barcode}<span class="text-muted-foreground font-mono text-xs"> {l.barcode}</span>{/if}
                <span class="text-muted-foreground block text-xs">
                  {t('transfers.line_counts', { quantity: l.quantity, received: l.received_quantity })}{#if l.lost_quantity} · {t('transfers.line_lost', { count: l.lost_quantity })}{/if}
                </span>
              </span>
              {#if open.status === 'in_transit' && l.outstanding > 0 && canEdit}
                <Field.Field class="w-28" data-invalid={!!receiveError(l) || undefined}>
                  <Field.Label for={`arr-${l.id}`} class="sr-only">{t('transfers.arrived_for', { name: l.barcode ?? name(l) })}</Field.Label>
                  <Input id={`arr-${l.id}`} type="number" min={0} max={l.outstanding} bind:value={arrived[l.id]} aria-invalid={!!receiveError(l)} />
                  {#if receiveError(l)}<Field.Error>{receiveError(l)}</Field.Error>{/if}
                </Field.Field>
              {/if}
            </li>
          {/each}
        </ul>
        {#if canEdit}
          <div class="flex flex-wrap gap-2">
            {#if open.status === 'planned'}
              <Button disabled={busy} onclick={() => act('dispatch', t('transfers.dispatched', { number: open.number }))}>{#if busy}<Spinner />{/if}{t('transfers.dispatch')}</Button>
              <Button variant="outline" disabled={busy} onclick={() => act('cancel', t('transfers.cancelled', { number: open.number }))}>{t('transfers.cancel')}</Button>
            {:else if open.status === 'in_transit'}
              <Button disabled={busy} onclick={() => receive(false)}>{#if busy}<Spinner />{/if}{t('transfers.receive')}</Button>
              <Button variant="outline" disabled={busy} onclick={() => receive(true)}>{t('transfers.close')}</Button>
              <Button variant="ghost" href={to('/scan')}>{t('transfers.receive_by_scan')}</Button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<!-- Planning a new transfer. -->
<Sheet.Root open={!!form} onOpenChange={(v) => !v && (form = null)}>
  <Sheet.Content class="overflow-y-auto sm:max-w-lg">
    {#if form}
      <form class="flex flex-col gap-4 p-4" onsubmit={save} novalidate>
        <Sheet.Header class="p-0">
          <Sheet.Title>{t('transfers.new')}</Sheet.Title>
          <Sheet.Description>{t('transfers.new_hint')}</Sheet.Description>
        </Sheet.Header>
        <Field.Group>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field data-invalid={!!errors.from_location_id || undefined}>
              <Field.Label for="trf-from">{t('transfers.from')}</Field.Label>
              <NativeSelect.Root id="trf-from" class="w-full" bind:value={form.from} aria-invalid={!!errors.from_location_id}>{#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
              {#if errors.from_location_id}<Field.Error>{errors.from_location_id}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.to_location_id || undefined}>
              <Field.Label for="trf-to">{t('transfers.to')}</Field.Label>
              <NativeSelect.Root id="trf-to" class="w-full" bind:value={form.to} aria-invalid={!!errors.to_location_id}>{#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
              {#if errors.to_location_id}<Field.Error>{errors.to_location_id}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.ships_at || undefined}>
              <Field.Label for="trf-ships">{t('transfers.ships_at')}</Field.Label>
              <Input id="trf-ships" type="datetime-local" bind:value={form.ships_at} aria-invalid={!!errors.ships_at} />
              {#if errors.ships_at}<Field.Error>{errors.ships_at}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.eta || undefined}>
              <Field.Label for="trf-eta">{t('transfers.eta')}</Field.Label>
              <Input id="trf-eta" type="datetime-local" bind:value={form.eta} aria-invalid={!!errors.eta} />
              {#if errors.eta}<Field.Error>{errors.eta}</Field.Error>{:else}<Field.Description>{t('transfers.eta_hint')}</Field.Description>{/if}
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="trf-unit">{t('transfers.add_unit')}</Field.Label>
            <Input id="trf-unit" autocomplete="off" placeholder={t('transfers.add_unit_placeholder')} bind:value={code} onkeydown={(e) => e.key === 'Enter' && addUnit(e)} />
          </Field.Field>
          <Field.Field>
            <Field.Label for="trf-bulk">{t('transfers.add_bulk')}</Field.Label>
            <Input id="trf-bulk" type="search" autocomplete="off" placeholder={t('pricing.search_product')} bind:value={query} oninput={search} />
            {#if results.length}
              <ul class="flex flex-col rounded-md border" aria-label={t('pricing.search_results')}>
                {#each results as r (r.id)}<li><button type="button" class="hover:bg-accent w-full px-3 py-1.5 text-left text-sm" onclick={() => addBulk(r)}>{r.name}</button></li>{/each}
              </ul>
            {/if}
          </Field.Field>
          <Field.Set data-invalid={!!errors.lines || undefined}>
            <Field.Legend variant="label">{t('transfers.stock')}</Field.Legend>
            {#if errors.lines}<Field.Error>{errors.lines}</Field.Error>{/if}
            {#each form.lines as l, i (l.barcode ?? l.variant_id)}
              {@const err = errors[`lines[${i}]`] ?? errors[`lines[${i}].quantity`]}
              <Field.Field orientation="horizontal" data-invalid={!!err || undefined} data-testid="transfer-form-line">
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class={l.barcode ? 'font-mono text-sm' : 'text-sm'}>{l.name}</span>
                  {#if err}<Field.Error>{err}</Field.Error>{/if}
                </div>
                {#if !l.barcode}
                  <Field.Label for={`trf-q-${i}`} class="sr-only">{t('transfers.quantity_for', { name: l.name })}</Field.Label>
                  <Input id={`trf-q-${i}`} type="number" min={1} class="w-20" bind:value={l.quantity} aria-invalid={!!err} />
                {/if}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('transfers.remove_line', { name: l.name })} onclick={() => form && (form.lines = form.lines.filter((_, j) => j !== i))}><XIcon /></Button>
              </Field.Field>
            {:else}
              <Field.Description>{t('transfers.no_lines')}</Field.Description>
            {/each}
          </Field.Set>
          <Field.Field>
            <Field.Label for="trf-notes">{t('transfers.notes')}</Field.Label>
            <Textarea id="trf-notes" bind:value={form.notes} />
          </Field.Field>
        </Field.Group>
        <Sheet.Footer class="p-0">
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('transfers.plan')}</Button>
        </Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
