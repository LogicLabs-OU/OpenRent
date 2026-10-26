<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import ReceiptIcon from '@lucide/svelte/icons/receipt';
  import XIcon from '@lucide/svelte/icons/x';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, session, getLocale, minorFromInput, majorFromMinor } from '#lib';
  import ScopePicker from './scope-picker.svelte';

  /** Fees added by rule (FR-PR-8): delivery, cleaning and damage waiver in quotes; extension and late fees on those actions. */
  const KINDS = ['delivery', 'cleaning', 'damage_waiver', 'extension', 'late'] as const;
  const CALCS = ['flat', 'per_unit', 'percent', 'per_period', 'zone'] as const;
  const UNITS = ['hour', 'day', 'week', 'month'] as const;
  type Draft = {
    id: string | null; name: string; kind: (typeof KINDS)[number]; calculation: (typeof CALCS)[number]; amount: string | number; period_unit: string;
    zones: { postcodes: string; amount: string | number }[]; mode: 'auto' | 'optional'; product_ids: string[]; category_ids: string[]; tax_profile_id: string; active: boolean;
  };

  let rules = $state<any[] | null>(null);
  let taxProfiles = $state<{ id: string; name: string }[]>([]);
  let edit = $state<Draft | null>(null);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  const canEdit = $derived(session.can('pricing:write'));
  const money = (n: number) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency: session.currency }).format(n / 100);
  const percent = (bp: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 2 }).format(bp / 10000);

  async function load() {
    const [r, tp] = await Promise.all([api.get('/fee_rules?limit=200'), api.get('/tax_profiles?limit=100')]);
    rules = r.data;
    taxProfiles = tp.data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  function open(r: any | null) {
    errors = {};
    edit = {
      id: r?.id ?? null,
      name: r?.name ?? '',
      kind: r?.kind ?? 'cleaning',
      calculation: r?.calculation ?? 'flat',
      amount: r ? (r.calculation === 'percent' ? String(r.amount / 100) : majorFromMinor(r.amount)) : '',
      period_unit: r?.period_unit ?? 'day',
      zones: (r?.zones ?? []).map((z: any) => ({ postcodes: z.postcodes.join(', '), amount: majorFromMinor(z.amount) })),
      mode: r?.mode ?? 'auto',
      product_ids: [...(r?.product_ids ?? [])],
      category_ids: [...(r?.category_ids ?? [])],
      tax_profile_id: r?.tax_profile_id ?? '',
      active: r?.active ?? true,
    };
    if (edit.calculation === 'zone' && !edit.zones.length) edit.zones = [{ postcodes: '', amount: '' }];
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!edit) return;
    saving = true;
    errors = {};
    try {
      const x = edit;
      const body = {
        name: x.name, kind: x.kind, calculation: x.calculation,
        amount: x.calculation === 'zone' ? 0 : x.calculation === 'percent' ? Math.round(Number(x.amount || 0) * 100) : minorFromInput(x.amount || 0),
        period_unit: x.calculation === 'per_period' ? x.period_unit : null,
        zones: x.calculation === 'zone' ? x.zones.map((z) => ({ postcodes: String(z.postcodes).split(/[,\s]+/).filter(Boolean), amount: minorFromInput(z.amount || 0) })).filter((z) => z.postcodes.length) : [],
        mode: x.kind === 'extension' || x.kind === 'late' ? 'auto' : x.mode,
        product_ids: x.product_ids, category_ids: x.category_ids, tax_profile_id: x.tax_profile_id || null, active: x.active,
      };
      if (x.id) await api.patch(`/fee_rules/${x.id}`, body);
      else await api.post('/fee_rules', body);
      toast.success(t('common.saved'));
      edit = null;
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  async function toggle(r: any, active: boolean) {
    try {
      await api.patch(`/fee_rules/${r.id}`, { active });
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function remove(r: any) {
    if (!(await confirmAction({ title: t('fees.delete_title', { name: r.name }), description: t('fees.delete_description'), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`/fee_rules/${r.id}`);
      toast.success(t('common.removed'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  /** "€15.00", "€3.00 per item", "10% of the rental", "€5.00 per day", "2 zones". */
  function price(r: any): string {
    switch (r.calculation) {
      case 'flat':
        return money(r.amount);
      case 'per_unit':
        return t('fees.price_per_unit', { amount: money(r.amount) });
      case 'percent':
        return t('fees.price_percent', { percent: percent(r.amount) });
      case 'per_period':
        return t('fees.price_per_period', { amount: money(r.amount), unit: t(`fees.unit.${r.period_unit}` as any) });
      default:
        return t('fees.price_zones', { count: r.zones.length });
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <p class="text-muted-foreground max-w-2xl text-sm">{t('fees.hint')}</p>
    {#if canEdit}<Button onclick={() => open(null)}><PlusIcon />{t('fees.new')}</Button>{/if}
  </div>
  {#if !rules}
    <Spinner />
  {:else if !rules.length}
    <Empty.Root class="border">
      <Empty.Header>
        <Empty.Media variant="icon"><ReceiptIcon /></Empty.Media>
        <Empty.Title>{t('fees.empty')}</Empty.Title>
        <Empty.Description>{t('fees.empty_hint')}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <Card.Root class="py-0">
      <Table.Root data-testid="fee-rules">
        <Table.Header>
          <Table.Row>
            <Table.Head>{t('field.name')}</Table.Head>
            <Table.Head>{t('pricing.kind')}</Table.Head>
            <Table.Head>{t('fees.price')}</Table.Head>
            <Table.Head>{t('fees.mode')}</Table.Head>
            <Table.Head>{t('pricing.active')}</Table.Head>
            <Table.Head class="w-24"><span class="sr-only">{t('common.more_actions')}</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each rules as r (r.id)}
            <Table.Row data-testid="fee-rule-row">
              <Table.Cell class="font-medium">{r.name}</Table.Cell>
              <Table.Cell><Badge variant="secondary">{t(`fees.kind.${r.kind}` as any)}</Badge></Table.Cell>
              <Table.Cell class="tabular-nums">{price(r)}</Table.Cell>
              <Table.Cell class="text-muted-foreground">{t(`fees.mode.${r.mode}` as any)}</Table.Cell>
              <Table.Cell><Switch checked={r.active} disabled={!canEdit} aria-label={t('pricing.active_label', { name: r.name })} onCheckedChange={(v) => toggle(r, v)} /></Table.Cell>
              <Table.Cell class="text-right">
                {#if canEdit}
                  <Button variant="ghost" size="icon-sm" aria-label={t('fees.edit', { name: r.name })} onclick={() => open(r)}><PencilIcon /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t('fees.delete_title', { name: r.name })} onclick={() => remove(r)}><Trash2Icon /></Button>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Root>
  {/if}
</div>

<Dialog.Root open={!!edit} onOpenChange={(v) => !v && (edit = null)}>
  <Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-xl">
    {#if edit}
      <form class="flex flex-col gap-4" onsubmit={save} novalidate>
        <Dialog.Header>
          <Dialog.Title>{edit.id ? t('fees.edit', { name: edit.name }) : t('fees.new')}</Dialog.Title>
        </Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="fee-name">{t('field.name')}</Field.Label>
            <Input id="fee-name" bind:value={edit.name} aria-invalid={!!errors.name} placeholder={t('fees.name_placeholder')} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{:else}<Field.Description>{t('fees.name_hint')}</Field.Description>{/if}
          </Field.Field>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="fee-kind">{t('pricing.kind')}</Field.Label>
              <NativeSelect id="fee-kind" class="w-full" bind:value={edit.kind}>
                {#each KINDS as k (k)}<NativeSelectOption value={k}>{t(`fees.kind.${k}` as any)}</NativeSelectOption>{/each}
              </NativeSelect>
            </Field.Field>
            {#if edit.kind !== 'extension' && edit.kind !== 'late'}
              <Field.Field data-invalid={!!errors.mode || undefined}>
                <Field.Label for="fee-mode">{t('fees.mode')}</Field.Label>
                <NativeSelect id="fee-mode" class="w-full" bind:value={edit.mode}>
                  <NativeSelectOption value="auto">{t('fees.mode.auto')}</NativeSelectOption>
                  <NativeSelectOption value="optional">{t('fees.mode.optional')}</NativeSelectOption>
                </NativeSelect>
                {#if errors.mode}<Field.Error>{errors.mode}</Field.Error>{/if}
              </Field.Field>
            {/if}
          </div>
          <Field.Description>{t(`fees.kind_hint.${edit.kind}` as any)}</Field.Description>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field data-invalid={!!errors.calculation || undefined}>
              <Field.Label for="fee-calc">{t('fees.calculation')}</Field.Label>
              <NativeSelect id="fee-calc" class="w-full" bind:value={edit.calculation} onchange={() => edit && edit.calculation === 'zone' && !edit.zones.length && (edit.zones = [{ postcodes: '', amount: '' }])}>
                {#each CALCS as c (c)}<NativeSelectOption value={c}>{t(`fees.calc.${c}` as any)}</NativeSelectOption>{/each}
              </NativeSelect>
              {#if errors.calculation}<Field.Error>{errors.calculation}</Field.Error>{/if}
            </Field.Field>
            {#if edit.calculation !== 'zone'}
              <Field.Field data-invalid={!!errors.amount || undefined}>
                <Field.Label for="fee-amount">{edit.calculation === 'percent' ? t('pricing.percent') : t('fees.amount', { currency: session.currency })}</Field.Label>
                <Input id="fee-amount" type="number" min="0" step="0.01" bind:value={edit.amount} aria-invalid={!!errors.amount} />
                {#if errors.amount}<Field.Error>{errors.amount}</Field.Error>{/if}
              </Field.Field>
            {/if}
          </div>
          {#if edit.calculation === 'per_period'}
            <Field.Field data-invalid={!!errors.period_unit || undefined}>
              <Field.Label for="fee-unit">{t('fees.per')}</Field.Label>
              <NativeSelect id="fee-unit" class="w-40" bind:value={edit.period_unit}>
                {#each UNITS as u (u)}<NativeSelectOption value={u}>{t(`fees.unit.${u}` as any)}</NativeSelectOption>{/each}
              </NativeSelect>
              {#if errors.period_unit}<Field.Error>{errors.period_unit}</Field.Error>{/if}
            </Field.Field>
          {/if}
          {#if edit.calculation === 'zone'}
            <Field.Set data-invalid={!!errors.zones || undefined}>
              <Field.Legend variant="label">{t('fees.zones')}</Field.Legend>
              <Field.Description>{t('fees.zones_hint')}</Field.Description>
              {#each edit.zones as z, i (i)}
                <div class="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                  <Field.Field>
                    <Field.Label for={`fee-zone-${i}`}>{t('fees.zone_postcodes', { n: i + 1 })}</Field.Label>
                    <Input id={`fee-zone-${i}`} placeholder="101, 102" bind:value={z.postcodes} />
                  </Field.Field>
                  <Field.Field>
                    <Field.Label for={`fee-zone-amount-${i}`}>{t('fees.amount', { currency: session.currency })}</Field.Label>
                    <Input id={`fee-zone-amount-${i}`} type="number" min="0" step="0.01" bind:value={z.amount} />
                  </Field.Field>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('fees.zone_remove', { n: i + 1 })} onclick={() => edit && (edit.zones = edit.zones.filter((_, j) => j !== i))}><XIcon /></Button>
                </div>
              {/each}
              <Button type="button" variant="outline" size="sm" class="w-fit" onclick={() => edit && (edit.zones = [...edit.zones, { postcodes: '', amount: '' }])}><PlusIcon />{t('fees.zone_add')}</Button>
              {#if errors.zones}<Field.Error>{errors.zones}</Field.Error>{/if}
            </Field.Set>
          {/if}
          <Field.Field>
            <Field.Label for="fee-tax">{t('fees.tax')}</Field.Label>
            <NativeSelect id="fee-tax" class="w-full" bind:value={edit.tax_profile_id}>
              <NativeSelectOption value="">{t('fees.tax_default')}</NativeSelectOption>
              {#each taxProfiles as tp (tp.id)}<NativeSelectOption value={tp.id}>{tp.name}</NativeSelectOption>{/each}
            </NativeSelect>
          </Field.Field>
          <ScopePicker idPrefix="fee" bind:productIds={edit.product_ids} bind:categoryIds={edit.category_ids} />
          <Field.Field orientation="horizontal">
            <Switch id="fee-active" bind:checked={edit.active} />
            <Field.Label for="fee-active" class="font-normal">{t('pricing.active')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (edit = null)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
