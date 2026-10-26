<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import PercentIcon from '@lucide/svelte/icons/percent';
  import { weekStart } from '@openrent/i18n';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, session, getLocale, d } from '#lib';
  import TagInput from './tag-input.svelte';
  import ScopePicker from './scope-picker.svelte';

  /** Price rules (FR-PR-7): seasonal, weekday, holiday, customer-group, volume and lead-time adjustments. */
  const KINDS = ['season', 'holiday', 'weekday', 'customer_group', 'volume', 'lead_time'] as const;
  type Kind = (typeof KINDS)[number];
  type Draft = {
    id: string | null; name: string; kind: Kind; direction: 'down' | 'up'; percent: string; priority: number; stackable: boolean; active: boolean;
    product_ids: string[]; category_ids: string[]; starts_on: string; ends_on: string; weekdays: string[]; customer_tags: string[];
    min_quantity: string; min_lead_days: string; max_lead_days: string;
  };

  let rules = $state<any[] | null>(null);
  let edit = $state<Draft | null>(null);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  const canEdit = $derived(session.can('pricing:write'));

  // Weekdays in the admin language, starting on the locale's first day (0 = Sunday).
  const first = $derived(weekStart(getLocale()));
  const days = $derived(Array.from({ length: 7 }, (_, i) => (first + i) % 7));
  const dayName = (n: number, style: 'short' | 'long' = 'short') => new Intl.DateTimeFormat(getLocale(), { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + n)));
  const pct = (bp: number) => new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 2, signDisplay: 'always' }).format(bp / 10000);

  async function load() {
    rules = (await api.get('/price_rules?limit=200&sort=priority')).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  function open(r: any | null) {
    errors = {};
    edit = {
      id: r?.id ?? null,
      name: r?.name ?? '',
      kind: r?.kind ?? 'season',
      direction: (r?.adjustment_bp ?? -1) < 0 ? 'down' : 'up',
      percent: r ? String(Math.abs(r.adjustment_bp) / 100) : '10',
      priority: r?.priority ?? 100,
      stackable: r?.stackable ?? false,
      active: r?.active ?? true,
      product_ids: [...(r?.product_ids ?? [])],
      category_ids: [...(r?.category_ids ?? [])],
      starts_on: r?.starts_on ?? '',
      ends_on: r?.ends_on ?? '',
      weekdays: (r?.weekdays ?? []).map(String),
      customer_tags: [...(r?.customer_tags ?? [])],
      min_quantity: r?.min_quantity != null ? String(r.min_quantity) : '',
      min_lead_days: r?.min_lead_days != null ? String(r.min_lead_days) : '',
      max_lead_days: r?.max_lead_days != null ? String(r.max_lead_days) : '',
    };
  }

  /** Number inputs bind numbers, or '' when empty. */
  const num = (v: string | number | null) => (v === '' || v == null ? null : Number(v));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!edit) return;
    saving = true;
    errors = {};
    try {
      const x = edit;
      const bp = Math.round(Number(x.percent || 0) * 100) * (x.direction === 'down' ? -1 : 1);
      const dated = x.kind === 'season' || x.kind === 'holiday';
      const body = {
        name: x.name, kind: x.kind, adjustment_bp: bp, priority: Number(x.priority) || 0, stackable: x.stackable, active: x.active,
        product_ids: x.product_ids, category_ids: x.category_ids,
        starts_on: dated ? x.starts_on || null : null, ends_on: dated ? x.ends_on || null : null,
        weekdays: x.kind === 'weekday' ? x.weekdays.map(Number) : [],
        customer_tags: x.kind === 'customer_group' ? x.customer_tags : [],
        min_quantity: x.kind === 'volume' ? num(x.min_quantity) : null,
        min_lead_days: x.kind === 'lead_time' ? num(x.min_lead_days) : null,
        max_lead_days: x.kind === 'lead_time' ? num(x.max_lead_days) : null,
      };
      if (x.id) await api.patch(`/price_rules/${x.id}`, body);
      else await api.post('/price_rules', body);
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
      await api.patch(`/price_rules/${r.id}`, { active });
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function remove(r: any) {
    if (!(await confirmAction({ title: t('pricing.rule_delete_title', { name: r.name }), description: t('pricing.rule_delete_description'), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`/price_rules/${r.id}`);
      toast.success(t('common.removed'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  /** "1 Jun – 31 Aug", "Sat, Sun", "Tags: vip", "From 5 units", "30+ days ahead". */
  function when(r: any): string {
    switch (r.kind as Kind) {
      case 'season':
      case 'holiday':
        return t('pricing.when_dates', { from: d(r.starts_on, 'UTC'), to: d(r.ends_on, 'UTC') });
      case 'weekday':
        return days.filter((n) => r.weekdays.includes(n)).map((n) => dayName(n)).join(', ');
      case 'customer_group':
        return t('pricing.when_tags', { tags: r.customer_tags.join(', ') });
      case 'volume':
        return t('pricing.when_quantity', { count: r.min_quantity });
      case 'lead_time':
        return r.min_lead_days != null && r.max_lead_days != null
          ? t('pricing.when_lead_between', { min: r.min_lead_days, max: r.max_lead_days })
          : r.min_lead_days != null
            ? t('pricing.when_lead_min', { count: r.min_lead_days })
            : t('pricing.when_lead_max', { count: r.max_lead_days });
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <p class="text-muted-foreground max-w-2xl text-sm">{t('pricing.rules_hint')}</p>
    {#if canEdit}<Button onclick={() => open(null)}><PlusIcon />{t('pricing.rule_new')}</Button>{/if}
  </div>

  {#if !rules}
    <Spinner />
  {:else if !rules.length}
    <Empty.Root class="border">
      <Empty.Header>
        <Empty.Media variant="icon"><PercentIcon /></Empty.Media>
        <Empty.Title>{t('pricing.rules_empty')}</Empty.Title>
        <Empty.Description>{t('pricing.rules_empty_hint')}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <Card.Root class="py-0">
      <Table.Root data-testid="price-rules">
        <Table.Header>
          <Table.Row>
            <Table.Head class="w-16">{t('pricing.priority')}</Table.Head>
            <Table.Head>{t('field.name')}</Table.Head>
            <Table.Head>{t('pricing.kind')}</Table.Head>
            <Table.Head>{t('pricing.when')}</Table.Head>
            <Table.Head class="text-right">{t('pricing.adjustment')}</Table.Head>
            <Table.Head>{t('pricing.active')}</Table.Head>
            <Table.Head class="w-24"><span class="sr-only">{t('common.more_actions')}</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each rules as r (r.id)}
            <Table.Row data-testid="price-rule-row">
              <Table.Cell class="text-muted-foreground tabular-nums">{r.priority}</Table.Cell>
              <Table.Cell class="font-medium">
                {r.name}
                {#if r.stackable}<Badge variant="outline" class="ml-1.5">{t('pricing.stackable')}</Badge>{/if}
                {#if r.product_ids.length || r.category_ids.length}<span class="text-muted-foreground block text-xs">{t('pricing.scope_count', { count: r.product_ids.length + r.category_ids.length })}</span>{/if}
              </Table.Cell>
              <Table.Cell><Badge variant="secondary">{t(`pricing.kind.${r.kind}` as any)}</Badge></Table.Cell>
              <Table.Cell class="text-muted-foreground whitespace-normal">{when(r)}</Table.Cell>
              <Table.Cell class={['text-right font-medium tabular-nums', r.adjustment_bp < 0 ? 'text-emerald-700 dark:text-emerald-400' : '']}>{pct(r.adjustment_bp)}</Table.Cell>
              <Table.Cell><Switch checked={r.active} disabled={!canEdit} aria-label={t('pricing.active_label', { name: r.name })} onCheckedChange={(v) => toggle(r, v)} /></Table.Cell>
              <Table.Cell class="text-right">
                {#if canEdit}
                  <Button variant="ghost" size="icon-sm" aria-label={t('pricing.rule_edit', { name: r.name })} onclick={() => open(r)}><PencilIcon /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t('pricing.rule_delete_title', { name: r.name })} onclick={() => remove(r)}><Trash2Icon /></Button>
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
          <Dialog.Title>{edit.id ? t('pricing.rule_edit', { name: edit.name }) : t('pricing.rule_new')}</Dialog.Title>
          <Dialog.Description>{t('pricing.rule_dialog_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="pr-name">{t('field.name')}</Field.Label>
            <Input id="pr-name" bind:value={edit.name} aria-invalid={!!errors.name} placeholder={t('pricing.name_placeholder')} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="pr-kind">{t('pricing.kind')}</Field.Label>
            <NativeSelect id="pr-kind" class="w-full" bind:value={edit.kind}>
              {#each KINDS as k (k)}<NativeSelectOption value={k}>{t(`pricing.kind.${k}` as any)}</NativeSelectOption>{/each}
            </NativeSelect>
            <Field.Description>{t(`pricing.kind_hint.${edit.kind}` as any)}</Field.Description>
          </Field.Field>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="pr-direction">{t('pricing.direction')}</Field.Label>
              <NativeSelect id="pr-direction" class="w-full" bind:value={edit.direction}>
                <NativeSelectOption value="down">{t('pricing.direction_down')}</NativeSelectOption>
                <NativeSelectOption value="up">{t('pricing.direction_up')}</NativeSelectOption>
              </NativeSelect>
            </Field.Field>
            <Field.Field data-invalid={!!errors.adjustment_bp || undefined}>
              <Field.Label for="pr-percent">{t('pricing.percent')}</Field.Label>
              <Input id="pr-percent" type="number" min="0" step="0.01" bind:value={edit.percent} aria-invalid={!!errors.adjustment_bp} />
              {#if errors.adjustment_bp}<Field.Error>{errors.adjustment_bp}</Field.Error>{/if}
            </Field.Field>
          </div>

          {#if edit.kind === 'season' || edit.kind === 'holiday'}
            <div class="grid gap-4 sm:grid-cols-2">
              <Field.Field data-invalid={!!errors.starts_on || undefined}>
                <Field.Label for="pr-from">{t('pricing.first_day')}</Field.Label>
                <Input id="pr-from" type="date" bind:value={edit.starts_on} aria-invalid={!!errors.starts_on} />
                {#if errors.starts_on}<Field.Error>{errors.starts_on}</Field.Error>{/if}
              </Field.Field>
              <Field.Field data-invalid={!!errors.ends_on || undefined}>
                <Field.Label for="pr-to">{t('pricing.last_day')}</Field.Label>
                <Input id="pr-to" type="date" bind:value={edit.ends_on} aria-invalid={!!errors.ends_on} />
                {#if errors.ends_on}<Field.Error>{errors.ends_on}</Field.Error>{/if}
              </Field.Field>
            </div>
          {:else if edit.kind === 'weekday'}
            <Field.Field data-invalid={!!errors.weekdays || undefined}>
              <Field.Label id="pr-days-label">{t('pricing.weekdays')}</Field.Label>
              <ToggleGroup.Root type="multiple" variant="outline" class="flex-wrap justify-start" bind:value={edit.weekdays} aria-labelledby="pr-days-label">
                {#each days as n (n)}<ToggleGroup.Item value={String(n)} aria-label={dayName(n, 'long')}>{dayName(n)}</ToggleGroup.Item>{/each}
              </ToggleGroup.Root>
              {#if errors.weekdays}<Field.Error>{errors.weekdays}</Field.Error>{/if}
            </Field.Field>
          {:else if edit.kind === 'customer_group'}
            <Field.Field data-invalid={!!errors.customer_tags || undefined}>
              <Field.Label>{t('pricing.customer_tags')}</Field.Label>
              <TagInput entity="customer" bind:value={edit.customer_tags} />
              {#if errors.customer_tags}<Field.Error>{errors.customer_tags}</Field.Error>{:else}<Field.Description>{t('pricing.customer_tags_hint')}</Field.Description>{/if}
            </Field.Field>
          {:else if edit.kind === 'volume'}
            <Field.Field data-invalid={!!errors.min_quantity || undefined}>
              <Field.Label for="pr-qty">{t('pricing.min_quantity')}</Field.Label>
              <Input id="pr-qty" type="number" min="1" class="w-32" bind:value={edit.min_quantity} aria-invalid={!!errors.min_quantity} />
              {#if errors.min_quantity}<Field.Error>{errors.min_quantity}</Field.Error>{/if}
            </Field.Field>
          {:else}
            <div class="grid gap-4 sm:grid-cols-2">
              <Field.Field data-invalid={!!errors.min_lead_days || undefined}>
                <Field.Label for="pr-lead-min">{t('pricing.min_lead_days')}</Field.Label>
                <Input id="pr-lead-min" type="number" min="0" bind:value={edit.min_lead_days} aria-invalid={!!errors.min_lead_days} />
                {#if errors.min_lead_days}<Field.Error>{errors.min_lead_days}</Field.Error>{:else}<Field.Description>{t('pricing.min_lead_hint')}</Field.Description>{/if}
              </Field.Field>
              <Field.Field>
                <Field.Label for="pr-lead-max">{t('pricing.max_lead_days')}</Field.Label>
                <Input id="pr-lead-max" type="number" min="0" bind:value={edit.max_lead_days} />
                <Field.Description>{t('pricing.max_lead_hint')}</Field.Description>
              </Field.Field>
            </div>
          {/if}

          <ScopePicker idPrefix="pr" bind:productIds={edit.product_ids} bind:categoryIds={edit.category_ids} />

          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="pr-priority">{t('pricing.priority')}</Field.Label>
              <Input id="pr-priority" type="number" min="0" class="w-32" bind:value={edit.priority} />
              <Field.Description>{t('pricing.priority_hint')}</Field.Description>
            </Field.Field>
            <div class="flex flex-col gap-3 sm:pt-6">
              <Field.Field orientation="horizontal">
                <Switch id="pr-stack" bind:checked={edit.stackable} />
                <Field.Label for="pr-stack" class="font-normal">{t('pricing.stackable_label')}</Field.Label>
              </Field.Field>
              <Field.Field orientation="horizontal">
                <Switch id="pr-active" bind:checked={edit.active} />
                <Field.Label for="pr-active" class="font-normal">{t('pricing.active')}</Field.Label>
              </Field.Field>
            </div>
          </div>
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (edit = null)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
