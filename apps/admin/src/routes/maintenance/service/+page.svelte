<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Field from '@openrent/ui/field';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader, StatusBadge } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { api, qs, t, toast, notifyError, fieldErrors, confirmAction, session, d, getLocale } from '#lib';
  import { to } from '#lib/nav.ts';

  /** Service intervals and the units that are due (FR-MNT-4). */
  let filter = $state<'' | 'overdue' | 'due_soon'>('');
  let due = $state<any[] | null>(null);
  let intervals = $state<any[]>([]);
  let products = $state<{ id: string; name: string; meter_unit: string | null }[]>([]);
  let categories = $state<{ id: string; name: string }[]>([]);
  type Form = { id: string | null; name: string; scope: 'all' | 'product' | 'category'; product_id: string; category_id: string; every_days: string; every_rentals: string; every_meter: string; opens_ticket: boolean; active: boolean; kind: 'service' | 'electrical_test' };
  let form = $state<Form | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const canEdit = $derived(session.can('inventory:write'));
  const num = (v: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(v);

  async function loadDue() {
    try {
      due = (await api.get(`/service_due?${qs({ status: filter || undefined, location_id: session.locationId || undefined })}`)).data;
    } catch (e) {
      notifyError(e);
    }
  }
  async function loadIntervals() {
    intervals = (await api.get('/service_intervals')).data;
  }
  $effect(() => {
    void [filter, session.locationId];
    loadDue();
  });
  onMount(() => {
    loadIntervals().catch(notifyError);
    api.get('/products?limit=200&filter[visibility]=public,hidden').then((r) => (products = r.data.filter((p: any) => p.variants.some((v: any) => v.tracking === 'serialized')).map((p: any) => ({ id: p.id, name: p.name, meter_unit: p.meter_unit }))), notifyError);
    api.get('/categories?limit=200').then((r) => (categories = r.data.map((c: any) => ({ id: c.id, name: c.name }))), notifyError);
  });

  const blank = (v: unknown) => v === '' || v == null;
  function edit(iv: any | null) {
    errors = {};
    form = iv
      ? {
          id: iv.id, name: iv.name, scope: iv.product_id ? 'product' : iv.category_id ? 'category' : 'all', product_id: iv.product_id ?? '', category_id: iv.category_id ?? '',
          every_days: iv.every_days ?? '', every_rentals: iv.every_rentals ?? '', every_meter: iv.every_meter ?? '', opens_ticket: iv.opens_ticket, active: iv.active, kind: iv.kind ?? 'service',
        }
      : { id: null, name: '', scope: 'all', product_id: '', category_id: '', every_days: '', every_rentals: '', every_meter: '', opens_ticket: true, active: true, kind: 'service' };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    busy = true;
    errors = {};
    const f = form;
    const body = {
      name: f.name, product_id: f.scope === 'product' ? f.product_id || null : null, category_id: f.scope === 'category' ? f.category_id || null : null,
      every_days: blank(f.every_days) ? null : Number(f.every_days), every_rentals: f.kind === 'electrical_test' || blank(f.every_rentals) ? null : Number(f.every_rentals), every_meter: f.kind === 'electrical_test' || blank(f.every_meter) ? null : Number(f.every_meter),
      opens_ticket: f.opens_ticket, active: f.active, kind: f.kind,
    };
    try {
      await (f.id ? api.patch(`/service_intervals/${f.id}`, body) : api.post('/service_intervals', body));
      toast.success(t('common.saved'));
      form = null;
      await Promise.all([loadIntervals(), loadDue()]);
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function archive() {
    if (!form?.id || !(await confirmAction({ title: t('service.archive_title', { name: form.name }), description: t('service.archive_description'), confirmLabel: t('checklists.archive'), destructive: true }))) return;
    try {
      await api.del(`/service_intervals/${form.id}`);
      form = null;
      await Promise.all([loadIntervals(), loadDue()]);
    } catch (err) {
      notifyError(err);
    }
  }

  const every = (iv: any) =>
    [iv.every_days && t('service.every_days', { count: iv.every_days }), iv.every_rentals && t('service.every_rentals', { count: iv.every_rentals }), iv.every_meter && t('service.every_meter', { count: num(iv.every_meter) })]
      .filter(Boolean)
      .join(' · ');
  const scope = (iv: any) => iv.product_name ?? iv.category_name ?? t('checklists.all_products');
  const reason = (r: any, unit: string | null) =>
    r.kind === 'days' ? t('service.reason.days', { date: d(r.due_at) }) : r.kind === 'rentals' ? t('service.reason.rentals', { count: r.rentals, every: r.every }) : t('service.reason.meter', { done: num(r.meter_since), every: num(r.every), unit: unit ?? '' });
</script>

<svelte:head><title>{t('service.title')} · OpenRent</title></svelte:head>

<PageHeader title={t('service.title')} description={t('service.description')}>
  {#snippet actions()}
    <Button variant="outline" href={to('/maintenance')}>{t('nav.maintenance')}</Button>
    {#if canEdit}<Button onclick={() => edit(null)}><PlusIcon />{t('service.new')}</Button>{/if}
  {/snippet}
</PageHeader>

<div class="grid gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{t('service.due_title')}</Card.Title>
      <Card.Action>
        <ToggleGroup.Root type="single" variant="outline" value={filter || 'all'} onValueChange={(v) => (filter = v === 'all' || !v ? '' : (v as typeof filter))} aria-label={t('email.log.filter')}>
          <ToggleGroup.Item value="all">{t('service.filter.all')}</ToggleGroup.Item>
          <ToggleGroup.Item value="overdue">{t('service.status.overdue')}</ToggleGroup.Item>
          <ToggleGroup.Item value="due_soon">{t('service.status.due_soon')}</ToggleGroup.Item>
        </ToggleGroup.Root>
      </Card.Action>
    </Card.Header>
    <Card.Content>
      <Table.Root data-testid="service-due">
        <Table.Header><Table.Row><Table.Head>{t('maintenance.col.unit')}</Table.Head><Table.Head>{t('service.interval')}</Table.Head><Table.Head>{t('service.why')}</Table.Head><Table.Head>{t('orders.col.status')}</Table.Head></Table.Row></Table.Header>
        <Table.Body>
          {#each due ?? [] as r (r.stock_item.id + r.interval.id)}
            <Table.Row>
              <Table.Cell><a class="font-medium hover:underline" href={to(`/inventory/units/${r.stock_item.id}`)}>{r.stock_item.product_name}</a> <span class="text-muted-foreground font-mono text-xs">{r.stock_item.barcode}</span></Table.Cell>
              <Table.Cell>{r.interval.name}</Table.Cell>
              <Table.Cell class="text-muted-foreground">{r.reasons.map((x: any) => reason(x, r.stock_item.meter_unit)).join(' · ')}</Table.Cell>
              <Table.Cell>
                <StatusBadge status={r.status === 'overdue' ? 'overdue' : 'pending'} label={t(`service.status.${r.status}` as any)} />
                {#if r.open_ticket_id}<a class="ml-2 text-xs hover:underline" href={to(`/maintenance?ticket=${r.open_ticket_id}`)}>{t('service.ticket_open')}</a>{/if}
              </Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={4} class="text-muted-foreground h-20 text-center">{due ? t('service.nothing_due') : t('common.loading')}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header><Card.Title>{t('service.intervals')}</Card.Title><Card.Description>{t('service.intervals_hint')}</Card.Description></Card.Header>
    <Card.Content>
      <Table.Root>
        <Table.Body>
          {#each intervals as iv (iv.id)}
            <Table.Row class="cursor-pointer" data-testid="interval-row" onclick={() => canEdit && edit(iv)}>
              <Table.Cell class="font-medium">{iv.name}{#if iv.kind === 'electrical_test'} <Badge variant="outline">{t('service.kind.pat_short')}</Badge>{/if}</Table.Cell><Table.Cell>{scope(iv)}</Table.Cell><Table.Cell class="text-muted-foreground">{every(iv)}</Table.Cell>
              <Table.Cell class="text-right">{#if !iv.active}<Badge variant="secondary">{t('checklists.inactive')}</Badge>{:else if iv.opens_ticket}<Badge variant="outline">{t('service.opens_ticket_short')}</Badge>{/if}</Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row><Table.Cell class="text-muted-foreground">{t('service.no_intervals')}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>
</div>

<Sheet.Root open={!!form} onOpenChange={(v) => !v && (form = null)}>
  <Sheet.Content class="overflow-y-auto sm:max-w-md">
    {#if form}
      <form class="flex flex-col gap-4 p-4" onsubmit={save} novalidate>
        <Sheet.Header class="p-0"><Sheet.Title>{form.id ? form.name : t('service.new')}</Sheet.Title><Sheet.Description>{t('service.editor_hint')}</Sheet.Description></Sheet.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="svi-name">{t('field.name')}</Field.Label>
            <Input id="svi-name" bind:value={form.name} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="svi-kind">{t('service.kind')}</Field.Label>
            <NativeSelect id="svi-kind" class="w-full" bind:value={form.kind}>
              <NativeSelectOption value="service">{t('service.kind.service')}</NativeSelectOption>
              <NativeSelectOption value="electrical_test">{t('service.kind.electrical_test')}</NativeSelectOption>
            </NativeSelect>
            {#if form.kind === 'electrical_test'}<Field.Description>{t('service.kind.electrical_test_hint')}</Field.Description>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="svi-scope">{t('service.applies_to')}</Field.Label>
            <NativeSelect id="svi-scope" class="w-full" bind:value={form.scope}>
              <NativeSelectOption value="all">{t('checklists.all_products')}</NativeSelectOption>
              <NativeSelectOption value="product">{t('service.scope.product')}</NativeSelectOption>
              <NativeSelectOption value="category">{t('service.scope.category')}</NativeSelectOption>
            </NativeSelect>
          </Field.Field>
          {#if form.scope === 'product'}
            <Field.Field data-invalid={!!errors.product_id || undefined}>
              <Field.Label for="svi-product">{t('service.scope.product')}</Field.Label>
              <NativeSelect id="svi-product" class="w-full" bind:value={form.product_id} aria-invalid={!!errors.product_id}>
                <NativeSelectOption value="">{t('service.choose')}</NativeSelectOption>
                {#each products as p (p.id)}<NativeSelectOption value={p.id}>{p.name}</NativeSelectOption>{/each}
              </NativeSelect>
              {#if errors.product_id}<Field.Error>{errors.product_id}</Field.Error>{/if}
            </Field.Field>
          {:else if form.scope === 'category'}
            <Field.Field data-invalid={!!errors.category_id || undefined}>
              <Field.Label for="svi-category">{t('service.scope.category')}</Field.Label>
              <NativeSelect id="svi-category" class="w-full" bind:value={form.category_id} aria-invalid={!!errors.category_id}>
                <NativeSelectOption value="">{t('service.choose')}</NativeSelectOption>
                {#each categories as c (c.id)}<NativeSelectOption value={c.id}>{c.name}</NativeSelectOption>{/each}
              </NativeSelect>
              {#if errors.category_id}<Field.Error>{errors.category_id}</Field.Error>{/if}
            </Field.Field>
          {/if}
          <div class="grid grid-cols-3 gap-3">
            {#each form.kind === 'electrical_test' ? [['every_days', 'service.days']] : [['every_days', 'service.days'], ['every_rentals', 'service.rentals'], ['every_meter', 'service.meter']] as [k, label] (k)}
              <Field.Field data-invalid={!!errors[k] || undefined}>
                <Field.Label for={`svi-${k}`}>{t(label as any)}</Field.Label>
                <Input id={`svi-${k}`} type="number" min="0" step={k === 'every_meter' ? 'any' : '1'} bind:value={form[k as 'every_days']} aria-invalid={!!errors[k]} />
                {#if errors[k]}<Field.Error>{errors[k]}</Field.Error>{/if}
              </Field.Field>
            {/each}
          </div>
          <Field.Description>{t('service.every_hint')}</Field.Description>
          <Field.Field orientation="horizontal">
            <Switch id="svi-ticket" bind:checked={form.opens_ticket} />
            <Field.Content><Field.Label for="svi-ticket" class="font-normal">{t('service.opens_ticket')}</Field.Label><Field.Description>{t('service.opens_ticket_hint')}</Field.Description></Field.Content>
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch id="svi-active" bind:checked={form.active} />
            <Field.Label for="svi-active" class="font-normal">{t('checklists.active')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <Sheet.Footer class="flex-row justify-between p-0">
          {#if form.id}<Button type="button" variant="ghost" onclick={archive}>{t('checklists.archive')}</Button>{:else}<span></span>{/if}
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('common.save')}</Button>
        </Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
