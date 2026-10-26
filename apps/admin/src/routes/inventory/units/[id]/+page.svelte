<script lang="ts">
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { PageHeader, StatusBadge, Money } from '@openrent/ui/openrent';
  import { api, t, toast, notifyError, fieldErrors, session, dt, d, getLocale } from '#lib';
  import { to } from '#lib/nav.ts';
  import InspectionRunner from '#lib/components/inspection-runner.svelte';

  /** One unit (FR-CAT-10, FR-MNT-3/4): meter, service, inspections, value and rentals. */
  const id = $derived(page.params.id!);
  let unit = $state<any>(null);
  let upkeep = $state<any>(null);
  let inspections = $state<any[]>([]);
  let history = $state<any[]>([]);
  let intervals = $state<any[]>([]);
  let reading = $state('');
  let serviceInterval = $state('');
  let serviceNotes = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const canEdit = $derived(session.can('inventory:write'));
  const money = (amount: number) => ({ amount, currency: upkeep?.currency ?? session.currency });
  const location = $derived(session.locations.find((l) => l.id === unit?.location_id)?.name ?? '');

  async function load() {
    try {
      const [u, k, ins, h] = await Promise.all([api.get(`/stock_items/${id}`), api.get(`/stock_items/${id}/upkeep`), api.get(`/stock_items/${id}/inspections`), api.get(`/stock_items/${id}/history`)]);
      [unit, upkeep, inspections, history] = [u, k, ins.data, h.data];
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    void id;
    load();
    api.get('/service_intervals').then((r) => (intervals = r.data), () => undefined);
  });

  async function addReading(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      await api.post(`/stock_items/${id}/actions/add_meter_reading`, { value: Number(reading) });
      reading = '';
      toast.success(t('meter.saved'));
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function recordService(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      await api.post(`/stock_items/${id}/actions/record_service`, { interval_id: serviceInterval, notes: serviceNotes || undefined });
      serviceNotes = '';
      toast.success(t('service.recorded'));
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  const num = (v: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(v);
  const reason = (r: any) =>
    r.kind === 'days' ? t('service.reason.days', { date: d(r.due_at) }) : r.kind === 'rentals' ? t('service.reason.rentals', { count: r.rentals, every: r.every }) : t('service.reason.meter', { done: num(r.meter_since), every: num(r.every), unit: upkeep?.meter.unit ?? '' });
</script>

<svelte:head><title>{unit ? `${unit.product_name} ${unit.barcode}` : t('unit.title')} · OpenRent</title></svelte:head>

{#if !unit || !upkeep}
  <Skeleton class="h-96 rounded-xl" />
{:else}
  <PageHeader title={`${unit.product_name}${unit.variant_name && unit.variant_name !== unit.product_name ? ` – ${unit.variant_name}` : ''}`} description={`${unit.barcode}${location ? ` · ${location}` : ''}`}>
    {#snippet actions()}
      <StatusBadge status={unit.status} label={t(`status.${unit.status}` as any)} />
      <Button variant="outline" href={to(`/inventory?q=${encodeURIComponent(unit.barcode)}`)}>{t('nav.inventory')}</Button>
    {/snippet}
  </PageHeader>

  <div class="grid gap-6 lg:grid-cols-2">
    <Card.Root>
      <Card.Header><Card.Title>{t('unit.details')}</Card.Title></Card.Header>
      <Card.Content>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {#if unit.serial}<dt class="text-muted-foreground">{t('inventory.serial')}</dt><dd>{unit.serial}</dd>{/if}
          <dt class="text-muted-foreground">{t('inventory.condition')}</dt><dd>{unit.condition}</dd>
          {#if unit.bin}<dt class="text-muted-foreground">{t('unit.bin')}</dt><dd>{unit.bin}</dd>{/if}
          <dt class="text-muted-foreground">{t('unit.purchased')}</dt><dd>{unit.purchase_date ? d(`${unit.purchase_date}T12:00:00Z`) : '–'}{#if unit.purchase_price != null} · <Money value={money(unit.purchase_price)} />{/if}</dd>
        </dl>
      </Card.Content>
    </Card.Root>

    <Card.Root data-testid="unit-value">
      <Card.Header><Card.Title>{t('unit.value')}</Card.Title><Card.Description>{t('unit.value_hint')}</Card.Description></Card.Header>
      <Card.Content class="text-sm">
        {#if upkeep.depreciation}
          {@const dep = upkeep.depreciation}
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt class="text-muted-foreground">{t('unit.book_value')}</dt><dd class="font-medium"><Money value={money(dep.book_value)} /></dd>
            <dt class="text-muted-foreground">{t('unit.depreciated')}</dt><dd><Money value={money(dep.depreciated)} /> · {t('unit.months_of', { done: dep.months_elapsed, life: dep.life_months })}</dd>
            <dt class="text-muted-foreground">{t('unit.monthly')}</dt><dd><Money value={money(dep.monthly)} /></dd>
            <dt class="text-muted-foreground">{t('unit.fully_at')}</dt><dd>{d(`${dep.fully_depreciated_at}T12:00:00Z`)} · {t('unit.residual')} <Money value={money(dep.residual_value)} /></dd>
          </dl>
        {:else}
          <p class="text-muted-foreground">{t('unit.no_value')}</p>
        {/if}
      </Card.Content>
    </Card.Root>

    {#if upkeep.meter.unit}
      <Card.Root data-testid="unit-meter">
        <Card.Header>
          <Card.Title>{t('meter.title')}</Card.Title>
          <Card.Description>{upkeep.meter.value == null ? t('meter.none_yet') : t('meter.current', { value: num(upkeep.meter.value), unit: upkeep.meter.unit })}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          {#if canEdit}
            <form class="flex items-end gap-2" onsubmit={addReading} novalidate>
              <Field.Field class="w-48" data-invalid={!!errors.value || undefined}>
                <Field.Label for="unit-reading">{t('meter.new_reading', { unit: upkeep.meter.unit })}</Field.Label>
                <Input id="unit-reading" type="number" min="0" step="any" bind:value={reading} aria-invalid={!!errors.value} />
                {#if errors.value}<Field.Error>{errors.value}</Field.Error>{/if}
              </Field.Field>
              <Button type="submit" variant="outline" disabled={busy || reading === '' || reading == null}>{t('meter.add')}</Button>
            </form>
          {/if}
          {#if upkeep.meter.readings.length}
            <Table.Root>
              <Table.Body>
                {#each upkeep.meter.readings.slice(0, 10) as r (r.id)}
                  <Table.Row><Table.Cell class="tabular-nums">{num(r.value)} {upkeep.meter.unit}</Table.Cell><Table.Cell class="text-muted-foreground">{t(`meter.source.${r.source}` as any)}</Table.Cell><Table.Cell class="text-muted-foreground text-right">{dt(r.recorded_at)}</Table.Cell></Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}

    <Card.Root data-testid="unit-service">
      <Card.Header><Card.Title>{t('service.title')}</Card.Title></Card.Header>
      <Card.Content class="flex flex-col gap-4 text-sm">
        {#each upkeep.service.due as s (s.interval.id)}
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status === 'overdue' ? 'overdue' : 'pending'} label={t(`service.status.${s.status}` as any)} />
            <span class="font-medium">{s.interval.name}</span>
            <span class="text-muted-foreground">{s.reasons.map(reason).join(' · ')}</span>
            {#if s.open_ticket_id}<a class="hover:underline" href={to(`/maintenance?ticket=${s.open_ticket_id}`)}>{t('service.ticket_open')}</a>{/if}
          </div>
        {:else}
          <p class="text-muted-foreground">{t('service.nothing_due')}</p>
        {/each}
        {#if canEdit && intervals.length}
          <form class="flex flex-wrap items-end gap-2" onsubmit={recordService} novalidate>
            <Field.Field class="w-56" data-invalid={!!errors.interval_id || undefined}>
              <Field.Label for="unit-interval">{t('service.record')}</Field.Label>
              <NativeSelect id="unit-interval" class="w-full" bind:value={serviceInterval} aria-invalid={!!errors.interval_id}>
                <NativeSelectOption value="">{t('service.choose')}</NativeSelectOption>
                {#each intervals as iv (iv.id)}<NativeSelectOption value={iv.id}>{iv.name}</NativeSelectOption>{/each}
              </NativeSelect>
              {#if errors.interval_id}<Field.Error>{errors.interval_id}</Field.Error>{/if}
            </Field.Field>
            <Field.Field class="min-w-48 flex-1">
              <Field.Label for="unit-service-notes">{t('service.notes')}</Field.Label>
              <Input id="unit-service-notes" bind:value={serviceNotes} />
            </Field.Field>
            <Button type="submit" variant="outline" disabled={busy || !serviceInterval}>{t('service.record_button')}</Button>
          </form>
        {/if}
        {#if upkeep.service.history.length}
          <ul class="flex flex-col divide-y rounded-md border">
            {#each upkeep.service.history as e (e.id)}
              <li class="flex flex-wrap justify-between gap-2 px-3 py-2"><span><span class="font-medium">{e.interval_name}</span>{#if e.notes} · {e.notes}{/if}</span><span class="text-muted-foreground">{dt(e.performed_at)}{#if e.meter_value != null} · {num(e.meter_value)} {upkeep.meter.unit ?? ''}{/if}</span></li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root data-testid="unit-inspections">
      <Card.Header>
        <Card.Title>{t('unit.inspections')}</Card.Title>
        {#if canEdit}<Card.Action><InspectionRunner stockItemId={unit.id} barcode={unit.barcode} ondone={load} /></Card.Action>{/if}
      </Card.Header>
      <Card.Content class="text-sm">
        {#each inspections as i (i.id)}
          <div class="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
            <span><Badge variant={i.passed ? 'secondary' : 'destructive'}>{i.passed ? t('inspection.pass') : t('inspection.fail')}</Badge> {i.template.name}</span>
            <span class="text-muted-foreground">{dt(i.created_at)}{#if i.performed_by?.name} · {i.performed_by.name}{/if}</span>
          </div>
        {:else}
          <p class="text-muted-foreground">{t('unit.no_inspections')}</p>
        {/each}
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-span-2">
      <Card.Header><Card.Title>{t('unit.rentals')}</Card.Title></Card.Header>
      <Card.Content>
        <Table.Root>
          <Table.Body>
            {#each history as h (h.order_id)}
              <Table.Row>
                <Table.Cell><a class="font-medium hover:underline" href={to(`/orders/${h.order_id}`)}>#{h.number}</a></Table.Cell>
                <Table.Cell>{dt(h.checked_out_at ?? h.starts_at)} – {dt(h.checked_in_at ?? h.ends_at)}</Table.Cell>
                <Table.Cell>{#if h.check_in_outcome}{t(`checkin.outcome.${h.check_in_outcome}` as any)}{/if}</Table.Cell>
                <Table.Cell class="text-right"><StatusBadge status={h.status} label={t(`status.${h.status}` as any)} /></Table.Cell>
              </Table.Row>
            {:else}
              <Table.Row><Table.Cell class="text-muted-foreground">{t('unit.no_rentals')}</Table.Cell></Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Content>
    </Card.Root>
  </div>
{/if}
