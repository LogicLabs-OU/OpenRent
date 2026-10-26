<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as Dialog from '@openrent/ui/dialog';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { PageHeader, formatMoney } from '@openrent/ui/openrent';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import SaveIcon from '@lucide/svelte/icons/save';
  import { api, qs, t, toast, notifyError, fieldErrors, session, download, confirmAction, d, dt } from '#lib';

  const REPORTS = ['revenue', 'utilization', 'availability_forecast', 'overdue', 'deposits_held', 'tax_summary', 'coupon_usage', 'fulfilment', 'depreciation', 'customer_value', 'product_roi', 'damage_frequency', 'staff_activity'];
  /** The groupings each report offers; the first is the default. */
  const GROUPS: Record<string, string[]> = {
    revenue: ['day', 'month', 'product', 'category', 'location'], utilization: ['variant', 'location'], tax_summary: ['rate', 'location'], depreciation: ['unit', 'location'],
    damage_frequency: ['product', 'unit'], staff_activity: ['user', 'action'],
  };
  /** Periods that stay relative, so a saved or scheduled report always covers the right days; '' = the dates below. */
  const RANGES = ['', 'today', 'last_7_days', 'last_30_days', 'this_month', 'last_month', 'year_to_date', 'last_year', 'all_time', 'next_7_days', 'next_14_days'];
  const SCHEDULES = ['', 'daily', 'weekly', 'monthly'];
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
  let name = $state('revenue');
  let from = $state(day(-30));
  let until = $state(day(1));
  let group = $state('day');
  let range = $state('');
  let locationId = $state(session.locationId);
  let rows = $state<any[]>([]);
  let errors = $state<Record<string, string>>({});
  const MONEY = new Set(['net', 'tax', 'total', 'amount', 'purchase_price', 'depreciated', 'book_value', 'paid', 'average_order', 'revenue', 'subrental_cost', 'repair_cost', 'net_return', 'charged']);
  const PERCENT = new Set(['utilization', 'roi', 'damage_rate']);
  const forecast = $derived(name === 'availability_forecast');
  /** The forecast looks ahead over whole days; the other reports look back. */
  function pick(next: string) {
    if (next === 'availability_forecast') [from, until, range] = [day(0), day(14), ''];
    else if (name === 'availability_forecast') [from, until] = [day(-30), day(1)];
    name = next;
    group = GROUPS[next]?.[0] ?? '';
  }
  const params = $derived({
    ...(range ? { range } : { from: forecast ? from : new Date(from).toISOString(), to: forecast ? until : new Date(until).toISOString() }),
    group_by: GROUPS[name] ? group : undefined,
    location_id: locationId || undefined,
  });

  // Saved reports (FR-REP-4): the filters under a name, optionally emailed on a schedule.
  let saved = $state<any[]>([]);
  let current = $state<any | null>(null);
  let dialog = $state(false);
  let form = $state({ name: '', schedule: '', format: 'csv', recipients: '' });
  let formErrors = $state<Record<string, string>>({});
  let saving = $state(false);
  const loadSaved = async () => (saved = (await api.get('/saved_reports?limit=100')).data);

  function apply(s: any) {
    current = s;
    name = s.report;
    group = s.params.group_by ?? GROUPS[s.report]?.[0] ?? '';
    locationId = s.params.location_id ?? '';
    range = s.params.range ?? '';
    if (!range) {
      const fc = s.report === 'availability_forecast';
      from = s.params.from ? (fc ? s.params.from : s.params.from.slice(0, 10)) : day(-30);
      until = s.params.to ? (fc ? s.params.to : s.params.to.slice(0, 10)) : day(1);
    }
  }
  $effect(() => {
    untrack(() =>
      loadSaved()
        .then(() => {
          const id = page.url.searchParams.get('saved');
          const s = id && saved.find((x) => x.id === id);
          if (s) apply(s);
        })
        .catch(notifyError),
    );
  });

  function openSave(asNew = false) {
    if (asNew) current = null;
    form = current
      ? { name: current.name, schedule: current.schedule ?? '', format: current.format, recipients: current.recipients.join(', ') }
      : { name: t(`reports.name.${name}` as any), schedule: '', format: 'csv', recipients: '' };
    formErrors = {};
    dialog = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    formErrors = {};
    const body = {
      name: form.name, report: name, params: Object.fromEntries(Object.entries(params).filter(([, v]) => v)), format: form.format, schedule: form.schedule || null,
      recipients: form.recipients.split(/[\s,;]+/).filter(Boolean),
    };
    try {
      current = current ? await api.patch(`/saved_reports/${current.id}`, body) : await api.post('/saved_reports', body);
      toast.success(t('reports.saved_toast'));
      dialog = false;
      await loadSaved();
    } catch (err) {
      formErrors = fieldErrors(err);
      if (!Object.keys(formErrors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  async function sendNow(s: any) {
    try {
      await api.post(`/saved_reports/${s.id}/actions/send`, {});
      toast.success(t('reports.send_queued', { count: s.recipients.length }));
    } catch (err) {
      notifyError(err);
    }
  }

  async function remove(s: any) {
    if (!(await confirmAction({ title: t('reports.delete_title'), description: t('reports.delete_text', { name: s.name }), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`/saved_reports/${s.id}`);
      if (current?.id === s.id) current = null;
      await loadSaved();
    } catch (err) {
      notifyError(err);
    }
  }
  /** Filter errors of a saved report (`params.range`, …) show under the schedule, which is what needs them. */
  const paramError = $derived(Object.entries(formErrors).find(([k]) => k.startsWith('params'))?.[1]);

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
    v == null ? '' : MONEY.has(k) && typeof v === 'number' ? formatMoney({ amount: v, currency: session.currency }) : PERCENT.has(k) ? `${(Number(v) * 100).toFixed(1)}%` : typeof v === 'boolean' ? (v ? t('common.yes') : t('common.no')) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? dt(v) : k === 'date' && typeof v === 'string' ? d(`${v}T12:00:00Z`) : String(v);
  /** Report columns with a translated heading; anything else shows its key. */
  const COLUMNS = new Set(['key', 'orders', 'net', 'tax', 'total', 'product', 'variant', 'tracking', 'capacity', 'booked_unit_hours', 'utilization', 'number', 'customer', 'phone', 'ends_at', 'hours_overdue', 'payment_status', 'amount', 'method', 'status', 'authorized_at', 'expires_at', 'rate_bp', 'code', 'kind', 'value', 'uses_count', 'orders_in_period', 'starts_at', 'picked_up_at', 'returned_at', 'on_time_pickup', 'on_time_return', 'date', 'location', 'booked', 'available', 'shortage', 'barcode', 'purchase_date', 'purchase_price', 'depreciated', 'book_value', 'fully_depreciated_at', 'units',
    'email', 'paid', 'average_order', 'first_order', 'last_order', 'revenue', 'subrental_cost', 'repair_cost', 'net_return', 'roi', 'returns', 'damaged', 'lost', 'charges', 'charged', 'damage_rate',
    'staff', 'actions', 'orders_created', 'check_outs', 'check_ins', 'payments', 'last_active', 'entity', 'action']);
  const heading = (c: string) => (COLUMNS.has(c) ? t(`reports.col.${c}` as any) : c);
</script>

<svelte:head><title>{t('nav.reports')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.reports')} description={t('reports.description')}>
  {#snippet actions()}
    {#if session.can('reports:write')}<Button variant="outline" onclick={() => openSave()}><SaveIcon />{current ? t('reports.update_saved') : t('reports.save')}</Button>{/if}
    <Button variant="outline" onclick={() => download(`/reports/${name}?${qs({ ...params, format: 'xlsx' })}`).catch(notifyError)}><DownloadIcon />{t('import.export_xlsx')}</Button>
    <Button variant="outline" href={`/api/v1/reports/${name}?${qs({ ...params, format: 'csv' })}`}><DownloadIcon />{t('reports.export_csv')}</Button>
  {/snippet}
</PageHeader>

<Field.Group class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
  <Field.Field><Field.Label for="rn">{t('reports.report')}</Field.Label><NativeSelect.Root id="rn" class="w-full" value={name} onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)}>{#each REPORTS as r}<NativeSelect.Option value={r}>{t(`reports.name.${r}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
  {#if GROUPS[name]}
    <Field.Field><Field.Label for="rg">{t('reports.group_by')}</Field.Label><NativeSelect.Root id="rg" class="w-full" bind:value={group}>{#each GROUPS[name] as g (g)}<NativeSelect.Option value={g}>{t(`reports.group.${g}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
  {/if}
  {#if session.locations.length > 1}
    <Field.Field><Field.Label for="rl">{t('field.location')}</Field.Label><NativeSelect.Root id="rl" class="w-full" bind:value={locationId}><NativeSelect.Option value="">{t('calendar.all_locations')}</NativeSelect.Option>{#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
  {/if}
  <Field.Field data-invalid={!!errors.range || undefined}>
    <Field.Label for="rp">{t('reports.period')}</Field.Label>
    <NativeSelect.Root id="rp" class="w-full" bind:value={range} aria-invalid={!!errors.range}>{#each RANGES as r (r)}<NativeSelect.Option value={r}>{t(`reports.range.${r || 'custom'}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
    {#if errors.range}<Field.Error>{errors.range}</Field.Error>{/if}
  </Field.Field>
  {#if !range}
    <Field.Field><Field.Label for="rf">{t('inventory.from')}</Field.Label><Input id="rf" type="date" bind:value={from} /></Field.Field>
    <Field.Field data-invalid={!!errors.to || undefined}><Field.Label for="rt">{t('inventory.until')}</Field.Label><Input id="rt" type="date" bind:value={until} aria-invalid={!!errors.to} />{#if errors.to}<Field.Error>{errors.to}</Field.Error>{/if}</Field.Field>
  {/if}
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

<section class="mt-8 flex flex-col gap-3" data-testid="saved-reports">
  <h2 class="text-lg font-semibold">{t('reports.saved_title')}</h2>
  {#if saved.length}
    <div class="overflow-hidden rounded-lg border">
      <Table.Root>
        <Table.Header class="bg-muted/50"><Table.Row><Table.Head>{t('field.name')}</Table.Head><Table.Head>{t('reports.report')}</Table.Head><Table.Head>{t('reports.schedule')}</Table.Head><Table.Head>{t('reports.next_send')}</Table.Head><Table.Head><span class="sr-only">{t('reports.actions')}</span></Table.Head></Table.Row></Table.Header>
        <Table.Body>
          {#each saved as s (s.id)}
            <Table.Row data-testid="saved-report">
              <Table.Cell class="font-medium">{s.name}</Table.Cell>
              <Table.Cell>{t(`reports.name.${s.report}` as any)}</Table.Cell>
              <Table.Cell>{s.schedule ? t('reports.schedule_to', { schedule: t(`reports.schedule.${s.schedule}` as any), count: s.recipients.length }) : t('reports.schedule.none')}{#if s.last_error}<span class="block text-sm text-destructive">{s.last_error}</span>{/if}</Table.Cell>
              <Table.Cell class="tabular-nums">{s.next_run_at ? dt(s.next_run_at) : ''}</Table.Cell>
              <Table.Cell class="text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onclick={() => apply(s)}>{t('reports.open')}</Button>
                {#if session.can('reports:write')}
                  {#if s.recipients.length}<Button size="sm" variant="ghost" onclick={() => sendNow(s)}>{t('reports.send_now')}</Button>{/if}
                  <Button size="sm" variant="ghost" onclick={() => remove(s)}>{t('common.delete')}</Button>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {:else}
    <p class="text-sm text-muted-foreground">{t('reports.saved_none')}</p>
  {/if}
</section>

<Dialog.Root bind:open={dialog}>
  <Dialog.Content>
    <form class="flex flex-col gap-4" onsubmit={save}>
      <Dialog.Header>
        <Dialog.Title>{current ? t('reports.update_saved') : t('reports.save')}</Dialog.Title>
        <Dialog.Description>{t('reports.save_hint')}</Dialog.Description>
      </Dialog.Header>
      <Field.Group>
        <Field.Field data-invalid={!!formErrors.name || undefined}>
          <Field.Label for="sr-name">{t('field.name')}</Field.Label>
          <Input id="sr-name" maxlength={200} bind:value={form.name} aria-invalid={!!formErrors.name} />
          {#if formErrors.name}<Field.Error>{formErrors.name}</Field.Error>{/if}
        </Field.Field>
        <div class="grid gap-4 sm:grid-cols-2">
          <Field.Field data-invalid={!!(formErrors.schedule || paramError) || undefined}>
            <Field.Label for="sr-schedule">{t('reports.schedule')}</Field.Label>
            <NativeSelect.Root id="sr-schedule" class="w-full" bind:value={form.schedule} aria-invalid={!!(formErrors.schedule || paramError)}>{#each SCHEDULES as s (s)}<NativeSelect.Option value={s}>{t(`reports.schedule.${s || 'none'}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
            {#if formErrors.schedule || paramError}<Field.Error>{formErrors.schedule || paramError}</Field.Error>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="sr-format">{t('reports.format')}</Field.Label>
            <!-- i18n-ignore --><NativeSelect.Root id="sr-format" class="w-full" bind:value={form.format}><NativeSelect.Option value="csv">CSV</NativeSelect.Option><NativeSelect.Option value="xlsx">XLSX</NativeSelect.Option></NativeSelect.Root>
          </Field.Field>
        </div>
        <Field.Field data-invalid={!!formErrors.recipients || undefined}>
          <Field.Label for="sr-to">{t('reports.recipients')}</Field.Label>
          <Input id="sr-to" bind:value={form.recipients} placeholder="books@example.com, owner@example.com" aria-invalid={!!formErrors.recipients} />
          <Field.Description>{t('reports.recipients_hint')}</Field.Description>
          {#if formErrors.recipients}<Field.Error>{formErrors.recipients}</Field.Error>{/if}
        </Field.Field>
      </Field.Group>
      <Dialog.Footer>
        {#if current}<Button type="button" variant="outline" onclick={() => openSave(true)}>{t('reports.save_as_new')}</Button>{/if}
        <Button type="submit" disabled={saving}>{t('common.save')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
