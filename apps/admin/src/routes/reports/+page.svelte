<script lang="ts">
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { PageHeader, formatMoney } from '@openrent/ui/openrent';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { api, qs, t, notifyError, fieldErrors, session, download, d, dt } from '#lib';

  const REPORTS = ['revenue', 'utilization', 'availability_forecast', 'overdue', 'deposits_held', 'tax_summary', 'coupon_usage', 'fulfilment'];
  /** The groupings each report offers; the first is the default. */
  const GROUPS: Record<string, string[]> = { revenue: ['day', 'month', 'product', 'category', 'location'], utilization: ['variant', 'location'], tax_summary: ['rate', 'location'] };
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
  let name = $state('revenue');
  let from = $state(day(-30));
  let until = $state(day(1));
  let group = $state('day');
  let locationId = $state(session.locationId);
  let rows = $state<any[]>([]);
  let errors = $state<Record<string, string>>({});
  const MONEY = new Set(['net', 'tax', 'total', 'amount']);
  const forecast = $derived(name === 'availability_forecast');
  /** The forecast looks ahead over whole days; the other reports look back. */
  function pick(next: string) {
    if (next === 'availability_forecast') [from, until] = [day(0), day(14)];
    else if (name === 'availability_forecast') [from, until] = [day(-30), day(1)];
    name = next;
    group = GROUPS[next]?.[0] ?? '';
  }
  const params = $derived({
    from: forecast ? from : new Date(from).toISOString(),
    to: forecast ? until : new Date(until).toISOString(),
    group_by: GROUPS[name] ? group : undefined,
    location_id: locationId || undefined,
  });

  $effect(() => {
    const p = params;
    api.get(`/reports/${name}?${qs(p)}`).then(
      (r) => {
        rows = r.data;
        errors = {};
      },
      (err) => {
        errors = fieldErrors(err);
        if (!Object.keys(errors).length) notifyError(err);
      },
    );
  });
  const cols = $derived(rows.length ? Object.keys(rows[0]).filter((c) => c !== 'id') : []);
  const cell = (k: string, v: any) =>
    v == null ? '' : MONEY.has(k) && typeof v === 'number' ? formatMoney({ amount: v, currency: session.currency }) : k === 'utilization' ? `${(Number(v) * 100).toFixed(1)}%` : typeof v === 'boolean' ? (v ? t('common.yes') : t('common.no')) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? dt(v) : k === 'date' && typeof v === 'string' ? d(`${v}T12:00:00Z`) : String(v);
  /** Report columns with a translated heading; anything else shows its key. */
  const COLUMNS = new Set(['key', 'orders', 'net', 'tax', 'total', 'product', 'variant', 'tracking', 'capacity', 'booked_unit_hours', 'utilization', 'number', 'customer', 'phone', 'ends_at', 'hours_overdue', 'payment_status', 'amount', 'method', 'status', 'authorized_at', 'expires_at', 'rate_bp', 'code', 'kind', 'value', 'uses_count', 'orders_in_period', 'starts_at', 'picked_up_at', 'returned_at', 'on_time_pickup', 'on_time_return', 'date', 'location', 'booked', 'available', 'shortage']);
  const heading = (c: string) => (COLUMNS.has(c) ? t(`reports.col.${c}` as any) : c);
</script>

<svelte:head><title>{t('nav.reports')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.reports')} description={t('reports.description')}>
  {#snippet actions()}
    <Button variant="outline" onclick={() => download(`/reports/${name}?${qs({ ...params, format: 'xlsx' })}`).catch(notifyError)}><DownloadIcon />{t('import.export_xlsx')}</Button>
    <Button variant="outline" href={`/api/v1/reports/${name}?${qs({ ...params, format: 'csv' })}`}><DownloadIcon />{t('reports.export_csv')}</Button>
  {/snippet}
</PageHeader>

<Field.Group class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
  <Field.Field><Field.Label for="rn">{t('reports.report')}</Field.Label><NativeSelect.Root id="rn" class="w-full" value={name} onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)}>{#each REPORTS as r}<NativeSelect.Option value={r}>{t(`reports.name.${r}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
  {#if GROUPS[name]}
    <Field.Field><Field.Label for="rg">{t('reports.group_by')}</Field.Label><NativeSelect.Root id="rg" class="w-full" bind:value={group}>{#each GROUPS[name] as g (g)}<NativeSelect.Option value={g}>{t(`reports.group.${g}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
  {/if}
  {#if session.locations.length > 1}
    <Field.Field><Field.Label for="rl">{t('field.location')}</Field.Label><NativeSelect.Root id="rl" class="w-full" bind:value={locationId}><NativeSelect.Option value="">{t('calendar.all_locations')}</NativeSelect.Option>{#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
  {/if}
  <Field.Field><Field.Label for="rf">{t('inventory.from')}</Field.Label><Input id="rf" type="date" bind:value={from} /></Field.Field>
  <Field.Field data-invalid={!!errors.to || undefined}><Field.Label for="rt">{t('inventory.until')}</Field.Label><Input id="rt" type="date" bind:value={until} aria-invalid={!!errors.to} />{#if errors.to}<Field.Error>{errors.to}</Field.Error>{/if}</Field.Field>
</Field.Group>

<div class="overflow-hidden rounded-lg border">
  <Table.Root>
    <Table.Header class="bg-muted/50"><Table.Row>{#each cols as c (c)}<Table.Head>{heading(c)}</Table.Head>{/each}</Table.Row></Table.Header>
    <Table.Body>
      {#each rows as r, i (i)}
        <Table.Row class={r.shortage || (forecast && r.available === 0) ? 'bg-destructive/5' : ''}>{#each cols as c (c)}<Table.Cell class="tabular-nums">{cell(c, r[c])}</Table.Cell>{/each}</Table.Row>
      {:else}
        <Table.Row><Table.Cell colspan={Math.max(1, cols.length)} class="h-24 text-center text-muted-foreground">{t('reports.empty')}</Table.Cell></Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>
