<script lang="ts">
  import * as Popover from '@openrent/ui/popover';
  import * as Field from '@openrent/ui/field';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { PageHeader } from '@openrent/ui/openrent';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { api, qs, t, toast, notifyError, session, dt, getLocale } from '#lib';
  import { to } from '#lib/nav.ts';

  /**
   * The unit planner (FR-AV-9): units as rows, bookings as bars. A booking that is not picked up can be
   * dragged to another unit of the same product, or moved with the bar's menu; if that unit is not free
   * the bar goes back. Only the rows in view are drawn.
   */
  const DAY = 86400_000;
  const ROW = 40;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: session.tz }).format(new Date());
  let start = $state(today());
  let days = $state(14);
  let product = $state('');
  let data = $state<any>(null);
  let products = $state<{ id: string; name: string }[]>([]);
  let scrollTop = $state(0);
  let viewport = $state(600);
  let dragging = $state<{ orderId: string; from: string; variantId: string } | null>(null);
  const canEdit = $derived(session.can('orders:write'));

  async function load() {
    try {
      const from = new Date(`${start}T00:00:00Z`).toISOString();
      data = await api.get(`/planner?${qs({ from, days, location_id: session.locationId || undefined, product_id: product || undefined })}`);
      if (!product) products = [...new Map(data.units.map((u: any) => [u.product_id, { id: u.product_id, name: u.product_name }])).values()] as any;
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    void [start, days, product, session.locationId];
    load();
  });

  function shift(n: number) {
    start = new Date(new Date(`${start}T00:00:00Z`).getTime() + n * days * DAY).toISOString().slice(0, 10);
  }
  const range = $derived(data ? { from: Date.parse(data.from), to: Date.parse(data.to) } : null);
  const dayList = $derived(data ? Array.from({ length: data.days }, (_, i) => new Date(Date.parse(data.from) + i * DAY)) : []);
  const dayLabel = (d: Date) => new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  function place(b: any) {
    const span = range!.to - range!.from;
    const s = Math.max(Date.parse(b.starts_at), range!.from);
    const e = Math.min(b.ends_at ? Date.parse(b.ends_at) : range!.to, range!.to);
    return `left:${((s - range!.from) / span) * 100}%;width:${Math.max(0.5, ((e - s) / span) * 100)}%`;
  }
  const units = $derived(data?.units ?? []);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 5));
  const last = $derived(Math.min(units.length, Math.ceil((scrollTop + viewport) / ROW) + 5));
  const others = (variantId: string, except: string) => units.filter((u: any) => u.variant_id === variantId && u.id !== except);

  /** Moves the bar right away and asks the server; a refusal puts it back. */
  async function move(orderId: string, from: string, toUnit: string) {
    if (from === toUnit) return;
    const before = data;
    const bar = data.units.find((u: any) => u.id === from)?.bars.find((b: any) => b.order?.id === orderId);
    if (bar) {
      data = { ...data, units: data.units.map((u: any) => (u.id === from ? { ...u, bars: u.bars.filter((b: any) => b !== bar) } : u.id === toUnit ? { ...u, bars: [...u.bars, bar] } : u)) };
    }
    try {
      await api.post(`/orders/${orderId}/actions/reassign_unit`, { from_stock_item_id: from, to_stock_item_id: toUnit });
      toast.success(t('planner.moved', { number: bar?.order?.number ?? '', code: units.find((u: any) => u.id === toUnit)?.barcode ?? '' }));
      await load();
    } catch (e) {
      data = before;
      notifyError(e);
    }
  }

  async function assign(x: any, unitId: string) {
    try {
      await api.post(`/orders/${x.order.id}/actions/assign_units`, { line_id: x.order_line_id, stock_item_ids: [unitId] });
      toast.success(t('planner.assigned', { number: x.order.number, code: units.find((u: any) => u.id === unitId)?.barcode ?? '' }));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  function drop(e: DragEvent, unit: any) {
    e.preventDefault();
    const d = dragging;
    dragging = null;
    if (d && d.variantId === unit.variant_id) move(d.orderId, d.from, unit.id);
  }
  const barClass = (b: any) =>
    b.kind === 'downtime' ? 'bg-destructive/15 text-destructive border-destructive/40' : b.kind === 'transfer' ? 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950 dark:text-violet-200' : b.picked_up ? 'bg-primary text-primary-foreground border-primary' : 'bg-primary/15 text-foreground border-primary/40';
  const barLabel = (b: any) => (b.order ? `#${b.order.number}${b.order.customer_name ? ` · ${b.order.customer_name}` : ''}` : t(`planner.kind.${b.kind}` as any));
</script>

<svelte:head><title>{t('nav.planner')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.planner')} description={t('planner.description')} />

<div class="mb-4 flex flex-wrap items-end gap-3">
  <Button variant="outline" size="icon" aria-label={t('planner.earlier')} onclick={() => shift(-1)}><ChevronLeftIcon /></Button>
  <Field.Field class="w-44">
    <Field.Label for="pl-start">{t('planner.start')}</Field.Label>
    <Input id="pl-start" type="date" bind:value={start} />
  </Field.Field>
  <Button variant="outline" size="icon" aria-label={t('planner.later')} onclick={() => shift(1)}><ChevronRightIcon /></Button>
  <ToggleGroup.Root type="single" variant="outline" value={String(days)} onValueChange={(v) => v && (days = Number(v))} aria-label={t('planner.span')}>
    {#each [7, 14, 31] as n (n)}<ToggleGroup.Item value={String(n)}>{t('planner.days', { count: n })}</ToggleGroup.Item>{/each}
  </ToggleGroup.Root>
  <Field.Field class="w-56">
    <Field.Label for="pl-product">{t('nav.products')}</Field.Label>
    <NativeSelect id="pl-product" class="w-full" bind:value={product}>
      <NativeSelectOption value="">{t('planner.all_products')}</NativeSelectOption>
      {#each products as p (p.id)}<NativeSelectOption value={p.id}>{p.name}</NativeSelectOption>{/each}
    </NativeSelect>
  </Field.Field>
  <Button variant="ghost" onclick={() => (start = today())}>{t('planner.today')}</Button>
</div>

{#if !data}
  <Skeleton class="h-96 rounded-xl" />
{:else}
  {#if data.truncated}<p class="text-muted-foreground mb-2 text-sm">{t('planner.truncated')}</p>{/if}
  <div class="overflow-x-auto rounded-lg border" data-testid="planner">
    <div class="min-w-[56rem]">
      <div class="bg-muted/50 grid grid-cols-[12rem_1fr] border-b text-xs">
        <div class="px-3 py-2 font-medium">{t('maintenance.col.unit')}</div>
        <div class="grid" style={`grid-template-columns:repeat(${data.days},minmax(0,1fr))`}>
          {#each dayList as d (d.getTime())}<div class="border-l px-1 py-2 text-center">{dayLabel(d)}</div>{/each}
        </div>
      </div>
      <div class="relative max-h-[65vh] overflow-y-auto" bind:clientHeight={viewport} onscroll={(e) => (scrollTop = (e.currentTarget as HTMLElement).scrollTop)}>
        <div style={`height:${units.length * ROW}px;position:relative`}>
          {#each units.slice(first, last) as u, i (u.id)}
            <div
              class="absolute inset-x-0 grid grid-cols-[12rem_1fr] border-b"
              style={`top:${(first + i) * ROW}px;height:${ROW}px`}
              role="row"
              tabindex="-1"
              data-testid="planner-row"
              data-unit={u.barcode}
              ondragover={(e) => dragging && dragging.variantId === u.variant_id && e.preventDefault()}
              ondrop={(e) => drop(e, u)}
            >
              <div class="flex min-w-0 items-center gap-2 px-3 text-sm">
                <a class="truncate font-mono text-xs hover:underline" href={to(`/inventory/units/${u.id}`)}>{u.barcode}</a>
                <span class="text-muted-foreground truncate text-xs">{u.product_name}</span>
              </div>
              <div class="relative">
                {#each u.bars as b (b.allocation_id)}
                  {#if b.movable && canEdit}
                    <!-- A popover opens on click, so dragging the bar does not open it. -->
                    <Popover.Root>
                      <Popover.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            type="button"
                            draggable="true"
                            ondragstart={() => (dragging = { orderId: b.order.id, from: u.id, variantId: u.variant_id })}
                            ondragend={() => (dragging = null)}
                            class={['absolute top-1.5 h-7 cursor-grab truncate rounded border px-1.5 text-left text-xs', barClass(b)]}
                            style={place(b)}
                            title={`${barLabel(b)} · ${dt(b.starts_at)} – ${b.ends_at ? dt(b.ends_at) : '…'}`}
                            data-testid="planner-bar"
                          >{barLabel(b)}</button>
                        {/snippet}
                      </Popover.Trigger>
                      <Popover.Content align="start" class="flex w-56 flex-col gap-1 p-2" data-testid="planner-menu">
                        <Button variant="ghost" size="sm" class="justify-start" href={to(`/orders/${b.order.id}`)}>{t('planner.open_order', { number: b.order.number })}</Button>
                        <p class="text-muted-foreground px-2 pt-1 text-xs font-medium">{t('planner.move_to')}</p>
                        {#each others(u.variant_id, u.id) as o (o.id)}
                          <Button variant="ghost" size="sm" class="justify-start font-mono" onclick={() => move(b.order.id, u.id, o.id)}>{o.barcode}</Button>
                        {/each}
                      </Popover.Content>
                    </Popover.Root>
                  {:else}
                    <a
                      class={['absolute top-1.5 block h-7 truncate rounded border px-1.5 text-xs leading-7', barClass(b)]}
                      style={place(b)}
                      href={b.order ? to(`/orders/${b.order.id}`) : undefined}
                      title={`${barLabel(b)} · ${dt(b.starts_at)} – ${b.ends_at ? dt(b.ends_at) : '…'}`}
                      data-testid="planner-bar"
                    >{barLabel(b)}</a>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
  {#if !units.length}<p class="text-muted-foreground mt-4 text-sm">{t('planner.empty')}</p>{/if}

  {#if data.unassigned.length}
    <h2 class="mt-8 mb-3 text-base font-semibold">{t('planner.unassigned')}</h2>
    <ul class="flex flex-col divide-y rounded-lg border text-sm" data-testid="planner-unassigned">
      {#each data.unassigned as x, i (`${x.order_line_id}:${x.starts_at}:${i}`)}
        <li class="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <span>
            <a class="font-medium hover:underline" href={to(`/orders/${x.order.id}`)}>#{x.order.number}</a>
            {x.product_name}{#if x.quantity > 1} <Badge variant="secondary">× {x.quantity}</Badge>{/if}
            <span class="text-muted-foreground"> · {dt(x.starts_at)} – {x.ends_at ? dt(x.ends_at) : '…'}</span>
          </span>
          {#if canEdit}
            <NativeSelect size="sm" value="" aria-label={t('planner.assign_to', { number: x.order.number })} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) assign(x, v); }}>
              <NativeSelectOption value="">{t('planner.assign_to', { number: x.order.number })}</NativeSelectOption>
              {#each units.filter((u: any) => u.variant_id === x.variant_id) as u (u.id)}<NativeSelectOption value={u.id}>{u.barcode}</NativeSelectOption>{/each}
            </NativeSelect>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.external?.length}
    <h2 class="mt-8 mb-3 text-base font-semibold">{t('planner.rented_in')}</h2>
    <ul class="flex flex-col divide-y rounded-lg border border-dashed text-sm" data-testid="planner-external">
      {#each data.external as x (x.id)}
        <li class="flex flex-wrap items-center gap-2 px-3 py-2">
          <Badge variant="outline" class="border-dashed">{t('planner.rented_in_badge')}</Badge>
          <span class="font-medium">{x.product_name}</span>{#if x.quantity > 1}<Badge variant="secondary">× {x.quantity}</Badge>{/if}
          <span class="text-muted-foreground">· {x.supplier} · {dt(x.starts_at)} – {dt(x.ends_at)}</span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
