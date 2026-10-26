<script lang="ts">
  import PluginSlot from '#lib/components/plugin-slot.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Tabs from '@openrent/ui/tabs';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { StatusBadge, PageHeader, formatMoney } from '@openrent/ui/openrent';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import PrinterIcon from '@lucide/svelte/icons/printer';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { api, session, t, toast, notifyError, fieldErrors, minorFromInput, majorFromMinor, openHtml, confirmAction, d, getLocale } from '#lib';
  import { weekStart } from '@openrent/i18n';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import * as Collapsible from '@openrent/ui/collapsible';
  import { to } from '#lib/nav.ts';
  import AvailabilityCalendar from '#lib/components/availability-calendar.svelte';
  import PhotoStrip from '#lib/components/photo-strip.svelte';
  import UnitCalendarFeed from '#lib/components/unit-calendar-feed.svelte';
  import RichTextEditor from '#lib/components/rich-text-editor.svelte';
  import TagInput from '#lib/components/tag-input.svelte';
  import CustomFieldsForm from '#lib/components/custom-fields-form.svelte';
  import ImageGallery from '#lib/components/image-gallery.svelte';
  import AuditHistory from '#lib/components/audit-history.svelte';
  import ProductTranslations from '#lib/components/product-translations.svelte';
  import * as Sheet from '@openrent/ui/sheet';
  import PencilIcon from '@lucide/svelte/icons/pencil';

  const id = $derived(page.params.id!);
  let p = $state<any>(null);
  let units = $state<Record<string, any[]>>({});
  let levels = $state<Record<string, number>>({});
  let edit = $state<any>({});
  let priceOpen = $state(false);
  let priceVariant = $state<any>(null);
  let priceForm = $state({ amount: '', kind: 'per_period', period_unit: 'day', rules: { non_billable_weekdays: [], free_pickup_day: false, pickup_after: '', free_return_day: false, return_before: '' } as Record<string, any> });
  /** Form values for a structure's charging-day rules; bound inputs need defined values. */
  const chargeRules = (r: Record<string, any> | null | undefined) => ({
    non_billable_weekdays: r?.non_billable_weekdays ?? [],
    free_pickup_day: !!r?.free_pickup_day,
    pickup_after: r?.pickup_after ?? '',
    free_return_day: !!r?.free_return_day,
    return_before: r?.return_before ?? '',
  });
  /** Weekday names in the admin language, starting on the locale's first day. */
  const weekdays = $derived.by(() => {
    const first = weekStart(getLocale());
    const name = (d: number) => new Intl.DateTimeFormat(getLocale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + d)));
    return Array.from({ length: 7 }, (_, i) => (first + i) % 7).map((d) => ({ day: d, label: name(d) }));
  });
  let addUnits = $state<Record<string, string>>({});
  let selected = $state<Set<string>>(new Set());
  let variantTab = $state('');
  let images = $state<any[]>([]);
  // Stock is added and counted at one location at a time; single-location shops never see the picker.
  let locationId = $state(session.locations[0]?.id ?? '');
  let unitEdit = $state<any>(null);
  let unitPhotos = $state<any[]>([]);
  const loadUnitPhotos = async (id: string) => (unitPhotos = (await api.get(`/stock_items/${id}`)).photos);
  let unitForm = $state<any>({});
  /** Booking rules a variant may override; blank means the product's value applies. */
  const RULES = ['buffer_before_min', 'buffer_after_min', 'min_notice_min', 'min_duration_min', 'max_duration_min', 'increment_min'] as const;
  let rulesForm = $state<Record<string, Record<string, string | number>>>({});
  let rulesErrors = $state<Record<string, Record<string, string>>>({});
  const blankToNull = (v: unknown) => (v === '' || v == null ? null : Number(v));
  async function saveVariantRules(v: any) {
    rulesErrors = { ...rulesErrors, [v.id]: {} };
    try {
      await api.patch(`/variants/${v.id}`, Object.fromEntries([...RULES, 'low_availability_threshold'].map((k) => [k, blankToNull(rulesForm[v.id]?.[k])])));
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      rulesErrors = { ...rulesErrors, [v.id]: fieldErrors(err) };
      if (!Object.keys(rulesErrors[v.id]!).length) notifyError(err);
    }
  }
  let unitErrors = $state<Record<string, string>>({});

  async function load() {
    p = await api.get(`/products/${id}`);
    images = p.images ?? [];
    if (!variantTab) variantTab = p.variants[0]?.id ?? '';
    edit = {
      name: p.name, description: p.description, visibility: p.visibility, deposit: majorFromMinor(p.deposit_amount), buffer_before_min: p.buffer_before_min,
      buffer_after_min: p.buffer_after_min, min_notice_min: p.min_notice_min, seo_title: p.seo?.title ?? '', seo_description: p.seo?.description ?? '',
      min_duration_min: p.min_duration_min ?? '', max_duration_min: p.max_duration_min ?? '', increment_min: p.increment_min ?? '',
      tags: [...(p.tags ?? [])], custom_fields: { ...(p.custom_fields ?? {}) },
      meter_unit: p.meter_unit ?? '', depreciation_months: p.depreciation_months ?? '', residual_pct: (p.residual_bp ?? 0) / 100,
    };
    rulesForm = Object.fromEntries(p.variants.map((v: any) => [v.id, Object.fromEntries([...RULES, 'low_availability_threshold'].map((k) => [k, v[k] ?? '']))]));
    for (const v of p.variants) {
      if (v.tracking === 'serialized') units[v.id] = (await api.get(`/stock_items?filter[variant_id]=${v.id}&limit=200`)).data;
      if (v.tracking === 'bulk') levels[v.id] = (await api.get(`/stock_levels?variant_id=${v.id}&location_id=${locationId}`)).data.reduce((a: number, l: any) => a + l.quantity, 0);
    }
  }
  onMount(() => {
    load().catch(notifyError);
  });

  /** Runs a change and reloads; `onFieldErrors` receives 422 errors to show next to fields (others become a toast). */
  const run = (fn: () => Promise<unknown>, msg: string, onFieldErrors?: (e: unknown) => Record<string, string>) =>
    fn().then(
      async () => {
        onFieldErrors?.(null);
        toast.success(msg);
        await load();
        return true;
      },
      (e) => {
        if (!onFieldErrors || !Object.keys(onFieldErrors(e)).length) notifyError(e);
        return false;
      },
    );

  let editErrors = $state<Record<string, string>>({});
  const save = () =>
    run(
      () =>
        api.patch(`/products/${p.id}`, {
          tags: edit.tags,
          custom_fields: edit.custom_fields,
          name: edit.name, description: edit.description, visibility: edit.visibility, deposit_amount: minorFromInput(edit.deposit || 0), buffer_before_min: Number(edit.buffer_before_min),
          buffer_after_min: Number(edit.buffer_after_min), min_notice_min: Number(edit.min_notice_min),
          min_duration_min: blankToNull(edit.min_duration_min), max_duration_min: blankToNull(edit.max_duration_min), increment_min: blankToNull(edit.increment_min),
          meter_unit: edit.meter_unit || null, depreciation_months: blankToNull(edit.depreciation_months), residual_bp: Math.round(Number(edit.residual_pct || 0) * 100), seo: { ...(p.seo ?? {}), title: edit.seo_title || undefined, description: edit.seo_description || undefined },
        }),
      t('common.saved'),
      (e) => (editErrors = fieldErrors(e)),
    );

  function editUnit(u: any) {
    unitEdit = u;
    unitPhotos = [];
    loadUnitPhotos(u.id).catch(notifyError);
    unitErrors = {};
    unitForm = { serial: u.serial ?? '', bin: u.bin ?? '', condition: u.condition ?? 'good', location_id: u.location_id, purchase_date: u.purchase_date ?? '', purchase_price: u.purchase_price == null ? '' : majorFromMinor(u.purchase_price), notes: u.notes ?? '', custom_fields: { ...(u.custom_fields ?? {}) } };
  }

  async function saveUnit(e: SubmitEvent) {
    e.preventDefault();
    unitErrors = {};
    try {
      await api.patch(`/stock_items/${unitEdit.id}`, {
        serial: unitForm.serial || null, bin: unitForm.bin || null, condition: unitForm.condition, location_id: unitForm.location_id, purchase_date: unitForm.purchase_date || null,
        purchase_price: unitForm.purchase_price === '' ? null : minorFromInput(unitForm.purchase_price), notes: unitForm.notes, custom_fields: unitForm.custom_fields,
      });
      unitEdit = null;
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      unitErrors = fieldErrors(err);
      if (!Object.keys(unitErrors).length) notifyError(err);
    }
  }
  const locationName = (lid: string) => session.locations.find((l) => l.id === lid)?.name ?? '';

  async function savePrice() {
    const r = priceForm.rules;
    const charge_day_rules = {
      non_billable_weekdays: r.non_billable_weekdays ?? [],
      free_pickup_day: !!r.free_pickup_day,
      pickup_after: r.free_pickup_day && r.pickup_after ? r.pickup_after : null,
      free_return_day: !!r.free_return_day,
      return_before: r.free_return_day && r.return_before ? r.return_before : null,
    };
    if (await run(() => api.patch(`/variants/${priceVariant.id}`, { price: { kind: priceForm.kind, period_unit: priceForm.period_unit, amount: minorFromInput(priceForm.amount), charge_day_rules } }), t('product.toast.price'))) priceOpen = false;
  }

  async function setStatus(unit: any, status: string) {
    try {
      const r = await api.post(`/stock_items/${unit.id}/actions/set_status`, { status, reason: t('inventory.status_reason_admin') });
      if (r.unassigned_from_orders?.length) toast.info(t('inventory.unassigned_from', { orders: r.unassigned_from_orders.map((n: number) => '#' + n).join(', ') }));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function archive() {
    if (await confirmAction({ title: t('product.archive_title'), description: t('product.archive_description'), confirmLabel: t('product.archive') })) await run(() => api.post(`/products/${p.id}/actions/archive`), t('product.toast.archived'));
  }
  async function duplicate() {
    try {
      const c = await api.post(`/products/${p.id}/actions/duplicate`);
      goto(to(`/products/${c.id}`));
    } catch (e) {
      notifyError(e);
    }
  }
  /** Button label for a variant's price; table prices have no single amount, so their kind is shown. */
  const priceText = (v: any) => {
    const ps = v.price_structure;
    if (!ps) return t('product.set_price');
    if (ps.kind === 'table') return t('structure.table');
    const amount = formatMoney({ amount: ps.amount, currency: ps.currency ?? session.currency });
    return ps.kind === 'fixed' ? amount : `${amount} / ${t(`period.${ps.period_unit}` as any)}${ps.kind === 'tiered' ? ` · ${t('product.tiered_short')}` : ''}`;
  };
</script>

<svelte:head><title>{p?.name ?? t('nav.products')} · OpenRent</title></svelte:head>

{#if p}
  <PageHeader title={p.name} description={`${t(`product.type.${p.type}` as any)} · /${p.slug}`}>
    <StatusBadge status={p.visibility} label={t(`visibility.${p.visibility}` as any)} />
    {#snippet actions()}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>{#snippet child({ props })}<Button variant="outline" size="icon" aria-label={t('common.more_actions')} {...props}><EllipsisIcon /></Button>{/snippet}</DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item onSelect={duplicate}>{t('product.duplicate')}</DropdownMenu.Item>
          <DropdownMenu.Item variant="destructive" onSelect={archive}>{t('product.archive')}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/snippet}
  </PageHeader>

  <div class="grid gap-6 lg:grid-cols-[1fr_380px]">
    <div class="flex min-w-0 flex-col gap-6">
      <ImageGallery productId={p.id} bind:images />
      {#if session.locations.length > 1 && p.variants.some((v: any) => v.tracking !== 'none')}
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium">{t('field.location')}</span>
          <NativeSelect.Root size="sm" bind:value={locationId} onchange={() => load().catch(notifyError)} aria-label={t('field.location')}>
            {#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}
          </NativeSelect.Root>
        </div>
      {/if}
      <Tabs.Root bind:value={variantTab}>
        {#if p.variants.length > 1}
          <Tabs.List>{#each p.variants as v (v.id)}<Tabs.Trigger value={v.id}>{v.name}</Tabs.Trigger>{/each}</Tabs.List>
        {/if}
        {#each p.variants as v (v.id)}
          <Tabs.Content value={v.id} class="flex flex-col gap-6">
            <Card.Root>
              <Card.Header>
                <Card.Title>{t('product.stock_and_price')}</Card.Title>
                <Card.Description>{t(`tracking.${v.tracking}_long` as any)}</Card.Description>
                {#if p.type !== 'bundle'}
                  <Card.Action><Button size="sm" variant="outline" data-testid="variant-price" onclick={() => { priceVariant = v; priceForm = { amount: majorFromMinor(v.price_structure?.amount ?? 0), kind: v.price_structure?.kind ?? 'per_period', period_unit: v.price_structure?.period_unit ?? 'day', rules: chargeRules(v.price_structure?.charge_day_rules) }; priceOpen = true; }}>{priceText(v)}</Button></Card.Action>
                {/if}
              </Card.Header>
              <Card.Content class="flex flex-col gap-4">
                {#if v.tracking === 'serialized'}
                  <div class="overflow-hidden rounded-lg border">
                    <Table.Root>
                      <Table.Header class="bg-muted/50">
                        <Table.Row>
                          <Table.Head class="w-10"><Checkbox checked={(units[v.id] ?? []).length > 0 && (units[v.id] ?? []).every((u) => selected.has(u.id))} onCheckedChange={(c) => (selected = c ? new Set((units[v.id] ?? []).map((u) => u.id)) : new Set())} aria-label={t('common.select_all')} /></Table.Head>
                          <Table.Head>{t('inventory.barcode')}</Table.Head><Table.Head>{t('inventory.serial')}</Table.Head><Table.Head>{t('inventory.condition')}</Table.Head>{#if session.locations.length > 1}<Table.Head>{t('field.location')}</Table.Head>{/if}<Table.Head>{t('orders.col.status')}</Table.Head><Table.Head class="w-52"></Table.Head>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {#each units[v.id] ?? [] as u (u.id)}
                          <Table.Row data-state={selected.has(u.id) ? 'selected' : undefined}>
                            <Table.Cell><Checkbox checked={selected.has(u.id)} onCheckedChange={(c) => { const s = new Set(selected); c ? s.add(u.id) : s.delete(u.id); selected = s; }} aria-label={t('common.select_item', { name: u.barcode })} /></Table.Cell>
                            <Table.Cell class="font-mono text-xs">{u.barcode}</Table.Cell>
                            <Table.Cell>{u.serial ?? ''}</Table.Cell>
                            <Table.Cell>{t(`condition.${u.condition}` as any)}</Table.Cell>
                            {#if session.locations.length > 1}<Table.Cell>{locationName(u.location_id)}</Table.Cell>{/if}
                            <Table.Cell><StatusBadge status={u.status} label={t(`status.${u.status}` as any)} /></Table.Cell>
                            <Table.Cell class="flex items-center gap-1">
                              <Button variant="ghost" size="icon-sm" aria-label={t('product.edit_unit', { code: u.barcode })} onclick={() => editUnit(u)}><PencilIcon /></Button>
                              <NativeSelect.Root size="sm" value="" onchange={(e) => { const s = (e.target as HTMLSelectElement).value; if (s) setStatus(u, s); }} aria-label={t('inventory.set_status')}>
                                <NativeSelect.Option value="">{t('inventory.set_status')}</NativeSelect.Option>
                                {#each ['available', 'needs_inspection', 'soft_down', 'hard_down', 'retired', 'lost'] as s}<NativeSelect.Option value={s}>{t(`status.${s}` as any)}</NativeSelect.Option>{/each}
                              </NativeSelect.Root>
                            </Table.Cell>
                          </Table.Row>
                        {/each}
                      </Table.Body>
                    </Table.Root>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Input type="number" min="1" max="100" class="w-24" placeholder="1" bind:value={addUnits[v.id]} aria-label={t('product.units_to_add')} />
                    <Button size="sm" variant="outline" onclick={() => run(() => api.post('/stock_items/batch', { variant_id: v.id, location_id: locationId, count: Number(addUnits[v.id] || 1) }), t('product.toast.units_added'))}><PlusIcon />{t('product.add_units')}</Button>
                    <Button size="sm" variant="ghost" disabled={!selected.size} onclick={() => openHtml('/labels/batch', { stock_item_ids: [...selected], format: 'html', layout: 'avery_l7160' }).catch(notifyError)}><PrinterIcon />{t('inventory.print_labels', { count: selected.size })}</Button>
                  </div>
                {:else if v.tracking === 'bulk'}
                  <Field.Field orientation="horizontal" class="max-w-md">
                    <Field.Label for={`lvl-${v.id}`}>{t('product.quantity_in_stock')}</Field.Label>
                    <Input id={`lvl-${v.id}`} type="number" min="0" class="w-28" value={levels[v.id] ?? 0} onchange={(e) => run(() => api.put(`/stock_levels/${v.id}/${locationId}`, { quantity: Number((e.target as HTMLInputElement).value), reason: t('inventory.reason_count') }), t('product.toast.stock'))} />
                    <Button size="sm" variant="ghost" onclick={() => openHtml('/labels/batch', { variant_ids: [v.id], format: 'html', layout: 'dymo_99012' }).catch(notifyError)}><PrinterIcon />{t('product.print_label')}</Button>
                  </Field.Field>
                {:else if p.bundle}
                  <ul class="flex flex-wrap gap-2">{#each p.bundle.components as c}<Badge variant="secondary">{c.quantity} × {c.name}</Badge>{/each}</ul>
                {:else}
                  <p class="text-sm text-muted-foreground">{t('product.no_stock')}</p>
                {/if}
              </Card.Content>
            </Card.Root>
            {#if v.tracking !== 'none' || p.type === 'bundle'}
              <Card.Root>
                <Card.Header><Card.Title>{t('product.availability')}</Card.Title></Card.Header>
                <Card.Content><AvailabilityCalendar variantId={v.id} /></Card.Content>
              </Card.Root>
            {/if}
            {#if p.type === 'rental' || p.type === 'bundle'}
              <Collapsible.Root open={RULES.some((k) => v[k] != null) || v.low_availability_threshold != null}>
                <Card.Root>
                  <Card.Header>
                    <Card.Title>{t('product.variant_rules')}</Card.Title>
                    <Card.Description>{t('product.variant_rules_hint')}</Card.Description>
                    <Card.Action>
                      <Collapsible.Trigger>{#snippet child({ props })}<Button size="sm" variant="ghost" {...props}>{t('product.variant_rules_toggle')}</Button>{/snippet}</Collapsible.Trigger>
                    </Card.Action>
                  </Card.Header>
                  <Collapsible.Content>
                    <Card.Content>
                      <form class="flex flex-col gap-4" data-testid="variant-rules" onsubmit={(e) => { e.preventDefault(); saveVariantRules(v); }}>
                        <Field.Group class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {#each RULES as k (k)}
                            {@const err = rulesErrors[v.id]?.[k]}
                            <Field.Field data-invalid={!!err || undefined}>
                              <Field.Label for={`vr-${v.id}-${k}`}>{t(`product.rule.${k}` as any)}</Field.Label>
                              <Input id={`vr-${v.id}-${k}`} type="number" min="0" placeholder={p[k] == null ? '—' : String(p[k])} bind:value={rulesForm[v.id]![k]} aria-invalid={!!err} />
                              {#if err}<Field.Error>{err}</Field.Error>{/if}
                            </Field.Field>
                          {/each}
                        </Field.Group>
                        <Field.Description>{t('product.variant_rules_blank')}</Field.Description>
                        <Field.Field class="max-w-xs" data-invalid={!!rulesErrors[v.id]?.low_availability_threshold || undefined}>
                          <Field.Label for={`vr-${v.id}-low`}>{t('product.low_availability_threshold')}</Field.Label>
                          <Input id={`vr-${v.id}-low`} type="number" min="0" bind:value={rulesForm[v.id]!.low_availability_threshold} aria-invalid={!!rulesErrors[v.id]?.low_availability_threshold} data-testid="low-availability-threshold" />
                          {#if rulesErrors[v.id]?.low_availability_threshold}<Field.Error>{rulesErrors[v.id]!.low_availability_threshold}</Field.Error>{/if}
                          <Field.Description>{t('product.low_availability_threshold_hint')}</Field.Description>
                        </Field.Field>
                        <div><Button type="submit" size="sm">{t('common.save')}</Button></div>
                      </form>
                    </Card.Content>
                  </Collapsible.Content>
                </Card.Root>
              </Collapsible.Root>
            {/if}
          </Tabs.Content>
        {/each}
      </Tabs.Root>
    </div>
    <Card.Root class="h-fit">
      <Card.Header><Card.Title>{t('common.details')}</Card.Title><Card.Description>{t('common.created', { when: d(p.created_at) })}</Card.Description></Card.Header>
      <Card.Content>
        <Field.Group>
          <Field.Field><Field.Label for="pn">{t('field.name')}</Field.Label><Input id="pn" bind:value={edit.name} /></Field.Field>
          <Field.Field><Field.Label for="pd">{t('field.description')}</Field.Label><RichTextEditor id="pd" label={t('field.description')} bind:value={edit.description} /></Field.Field>
          <Field.Field><Field.Label for="ptags">{t('field.tags')}</Field.Label><TagInput id="ptags" entity="product" bind:value={edit.tags} /></Field.Field>
          <CustomFieldsForm entity="product" bind:value={edit.custom_fields} errors={editErrors} />
          <Field.Field>
            <Field.Label for="pv">{t('product.visibility')}</Field.Label>
            <NativeSelect.Root id="pv" class="w-full" bind:value={edit.visibility}>{#each ['public', 'hidden', 'archived'] as x}<NativeSelect.Option value={x}>{t(`visibility.${x}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
          </Field.Field>
          <Field.Field><Field.Label for="pdep">{t('product.deposit')} ({session.currency})</Field.Label><Input id="pdep" bind:value={edit.deposit} /></Field.Field>
          <div class="grid grid-cols-3 gap-3">
            <Field.Field><Field.Label for="bb">{t('product.buffer_before_short')}</Field.Label><Input id="bb" type="number" min="0" bind:value={edit.buffer_before_min} /></Field.Field>
            <Field.Field><Field.Label for="ba">{t('product.buffer_after_short')}</Field.Label><Input id="ba" type="number" min="0" bind:value={edit.buffer_after_min} /></Field.Field>
            <Field.Field><Field.Label for="mn">{t('product.notice_short')}</Field.Label><Input id="mn" type="number" min="0" bind:value={edit.min_notice_min} /></Field.Field>
            <Field.Field><Field.Label for="mind">{t('product.min_duration_short')}</Field.Label><Input id="mind" type="number" min="1" bind:value={edit.min_duration_min} /></Field.Field>
            <Field.Field><Field.Label for="maxd">{t('product.max_duration_short')}</Field.Label><Input id="maxd" type="number" min="1" bind:value={edit.max_duration_min} /></Field.Field>
            <Field.Field><Field.Label for="inc">{t('product.increment_short')}</Field.Label><Input id="inc" type="number" min="1" bind:value={edit.increment_min} /></Field.Field>
          </div>
          <Field.Description>{t('product.minutes_hint_rules')}</Field.Description>
          <Field.Separator />
          <!-- Meter and depreciation of the units (FR-CAT-10). -->
          <div class="grid grid-cols-3 gap-3">
            <Field.Field data-invalid={!!editErrors.meter_unit || undefined}>
              <Field.Label for="pmeter">{t('product.meter_unit')}</Field.Label>
              <Input id="pmeter" maxlength={20} placeholder={t('product.meter_unit_placeholder')} bind:value={edit.meter_unit} />
              {#if editErrors.meter_unit}<Field.Error>{editErrors.meter_unit}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!editErrors.depreciation_months || undefined}>
              <Field.Label for="plife">{t('product.depreciation_months')}</Field.Label>
              <Input id="plife" type="number" min="1" max="600" bind:value={edit.depreciation_months} />
              {#if editErrors.depreciation_months}<Field.Error>{editErrors.depreciation_months}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!editErrors.residual_bp || undefined}>
              <Field.Label for="presid">{t('product.residual_pct')}</Field.Label>
              <Input id="presid" type="number" min="0" max="100" step="0.01" bind:value={edit.residual_pct} />
              {#if editErrors.residual_bp}<Field.Error>{editErrors.residual_bp}</Field.Error>{/if}
            </Field.Field>
          </div>
          <Field.Description>{t('product.meter_hint')}</Field.Description>
          <Field.Separator />
          <Field.Field><Field.Label for="seo-t">{t('product.seo_title')}</Field.Label><Input id="seo-t" maxlength={70} placeholder={edit.name} bind:value={edit.seo_title} /></Field.Field>
          <Field.Field>
            <Field.Label for="seo-d">{t('product.seo_description')}</Field.Label>
            <Textarea id="seo-d" maxlength={160} bind:value={edit.seo_description} />
            <Field.Description>{t('product.seo_hint', { count: (edit.seo_description ?? '').length })}</Field.Description>
          </Field.Field>
        </Field.Group>
      </Card.Content>
      <Card.Footer><Button onclick={save}>{t('common.save')}</Button></Card.Footer>
    </Card.Root>
  </div>
  <div class="mt-6 grid gap-6 lg:grid-cols-2">
    {#key p.updated_at}<ProductTranslations product={p} {images} onsaved={() => load().catch(notifyError)} />{/key}
    <AuditHistory entityType="product" entityId={p.id} />
    <PluginSlot slot="product.tab" context={{ product_id: p.id }} />
  </div>

  <Sheet.Root open={!!unitEdit} onOpenChange={(o) => !o && (unitEdit = null)}>
    <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
      {#if unitEdit}
        <form class="flex h-full flex-col" onsubmit={saveUnit}>
          <Sheet.Header><Sheet.Title class="font-mono">{unitEdit.barcode}</Sheet.Title><Sheet.Description>{t('product.unit_hint')}</Sheet.Description></Sheet.Header>
          <Field.Group class="px-4">
            <Field.Field>
              <Field.Label>{t('photos.title')}</Field.Label>
              <PhotoStrip photos={unitPhotos} attachPath={`/stock_items/${unitEdit.id}/photos`} onadded={() => loadUnitPhotos(unitEdit.id).catch(notifyError)} />
            </Field.Field>
            <Field.Field data-invalid={!!unitErrors.serial || undefined}><Field.Label for="u-serial">{t('inventory.serial')}</Field.Label><Input id="u-serial" bind:value={unitForm.serial} />{#if unitErrors.serial}<Field.Error>{unitErrors.serial}</Field.Error>{/if}</Field.Field>
            <Field.Field><Field.Label for="u-bin">{t('product.bin')}</Field.Label><Input id="u-bin" maxlength={40} placeholder="A-03" bind:value={unitForm.bin} /><Field.Description>{t('product.bin_hint')}</Field.Description></Field.Field>
            <Field.Field>
              <Field.Label for="u-cond">{t('inventory.condition')}</Field.Label>
              <NativeSelect.Root id="u-cond" class="w-full" bind:value={unitForm.condition}>{#each ['new', 'good', 'fair', 'worn', 'poor'] as c (c)}<NativeSelect.Option value={c}>{t(`condition.${c}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
            </Field.Field>
            {#if session.locations.length > 1}
              <Field.Field data-invalid={!!unitErrors.location_id || undefined}>
                <Field.Label for="u-loc">{t('field.location')}</Field.Label>
                <NativeSelect.Root id="u-loc" class="w-full" bind:value={unitForm.location_id}>{#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
              </Field.Field>
            {/if}
            <div class="grid grid-cols-2 gap-3">
              <Field.Field data-invalid={!!unitErrors.purchase_date || undefined}><Field.Label for="u-pd">{t('product.purchase_date')}</Field.Label><Input id="u-pd" type="date" bind:value={unitForm.purchase_date} /></Field.Field>
              <Field.Field data-invalid={!!unitErrors.purchase_price || undefined}><Field.Label for="u-pp">{t('product.purchase_price')} ({session.currency})</Field.Label><Input id="u-pp" inputmode="decimal" bind:value={unitForm.purchase_price} /></Field.Field>
            </div>
            <Field.Field><Field.Label for="u-notes">{t('order.notes')}</Field.Label><Textarea id="u-notes" bind:value={unitForm.notes} /></Field.Field>
            <CustomFieldsForm entity="stock_item" bind:value={unitForm.custom_fields} errors={unitErrors} />
            {#if session.can('tenant:write')}<UnitCalendarFeed stockItemId={unitEdit.id} label={unitEdit.barcode} />{/if}
          </Field.Group>
          <Sheet.Footer class="mt-auto"><Button type="submit">{t('common.save')}</Button></Sheet.Footer>
        </form>
      {/if}
    </Sheet.Content>
  </Sheet.Root>

  <Dialog.Root bind:open={priceOpen}>
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>{t('product.change_price')}</Dialog.Title><Dialog.Description>{t('product.change_price_hint')}</Dialog.Description></Dialog.Header>
      <Field.Group class="grid gap-4 sm:grid-cols-3">
        <Field.Field><Field.Label for="pk">{t('product.structure')}</Field.Label><NativeSelect.Root id="pk" class="w-full" bind:value={priceForm.kind}>{#each ['per_period', 'fixed'] as k}<NativeSelect.Option value={k}>{t(`structure.${k}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
        <Field.Field><Field.Label for="pu">{t('product.period')}</Field.Label><NativeSelect.Root id="pu" class="w-full" bind:value={priceForm.period_unit}>{#each ['hour', 'day', 'week', 'month'] as x}<NativeSelect.Option value={x}>{t(`period.${x}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
        <Field.Field><Field.Label for="pa">{t('field.amount')} ({session.currency})</Field.Label><Input id="pa" bind:value={priceForm.amount} /></Field.Field>
      </Field.Group>
      {#if priceForm.kind !== 'fixed' && priceForm.period_unit === 'day'}
        <Field.Set>
          <Field.Legend variant="label">{t('product.charge_days')}</Field.Legend>
          <Field.Description>{t('product.charge_days_hint')}</Field.Description>
          <Field.Group class="gap-3">
            <Field.Field>
              <Field.Label>{t('product.non_billable_weekdays')}</Field.Label>
              <ToggleGroup.Root type="multiple" variant="outline" size="sm" class="flex-wrap" bind:value={() => (priceForm.rules.non_billable_weekdays ?? []).map(String), (v: string[]) => (priceForm.rules.non_billable_weekdays = v.map(Number))}>
                {#each weekdays as w (w.day)}<ToggleGroup.Item value={String(w.day)}>{w.label}</ToggleGroup.Item>{/each}
              </ToggleGroup.Root>
            </Field.Field>
            <Field.Field orientation="horizontal">
              <Checkbox id="fpd" bind:checked={priceForm.rules.free_pickup_day} />
              <Field.Label for="fpd" class="font-normal">{t('product.free_pickup_day')}</Field.Label>
              {#if priceForm.rules.free_pickup_day}<Input type="time" class="w-32" aria-label={t('product.pickup_after')} title={t('product.pickup_after')} bind:value={priceForm.rules.pickup_after} />{/if}
            </Field.Field>
            <Field.Field orientation="horizontal">
              <Checkbox id="frd" bind:checked={priceForm.rules.free_return_day} />
              <Field.Label for="frd" class="font-normal">{t('product.free_return_day')}</Field.Label>
              {#if priceForm.rules.free_return_day}<Input type="time" class="w-32" aria-label={t('product.return_before')} title={t('product.return_before')} bind:value={priceForm.rules.return_before} />{/if}
            </Field.Field>
          </Field.Group>
        </Field.Set>
      {/if}
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button onclick={savePrice}>{t('common.save')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <Skeleton class="mb-6 h-10 w-72" />
  <div class="grid gap-6 lg:grid-cols-[1fr_380px]"><Skeleton class="h-96 rounded-xl" /><Skeleton class="h-96 rounded-xl" /></div>
{/if}
