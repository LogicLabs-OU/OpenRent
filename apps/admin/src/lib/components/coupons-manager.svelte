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
  import TicketIcon from '@lucide/svelte/icons/ticket';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, session, getLocale, d, toLocalInput, fromLocalInput, minorFromInput, majorFromMinor } from '#lib';
  import ScopePicker from './scope-picker.svelte';

  /** Coupon codes customers enter at checkout (FR-PR-6). Percent values are basis points, fixed ones minor units. */
  type Draft = {
    id: string | null; code: string; kind: 'percent' | 'fixed'; value: string; valid_from: string; valid_until: string; max_uses: string;
    max_uses_per_customer: string; min_order: string; combinable: boolean; active: boolean; product_ids: string[]; category_ids: string[];
  };
  let coupons = $state<any[] | null>(null);
  let edit = $state<Draft | null>(null);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  const canEdit = $derived(session.can('pricing:write'));
  const currency = $derived(session.currency);
  const money = (n: number) => new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(n / 100);
  const value = (c: any) => (c.kind === 'percent' ? new Intl.NumberFormat(getLocale(), { style: 'percent', maximumFractionDigits: 2 }).format(c.value / 10000) : money(c.value));

  async function load() {
    coupons = (await api.get('/coupons?limit=200')).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  function open(c: any | null) {
    errors = {};
    const ids = c?.scope?.ids ?? [];
    edit = {
      id: c?.id ?? null,
      code: c?.code ?? '',
      kind: c?.kind ?? 'percent',
      value: c ? (c.kind === 'percent' ? String(c.value / 100) : majorFromMinor(c.value)) : '10',
      valid_from: c?.valid_from ? toLocalInput(c.valid_from) : '',
      valid_until: c?.valid_until ? toLocalInput(c.valid_until) : '',
      max_uses: c?.max_uses != null ? String(c.max_uses) : '',
      max_uses_per_customer: c?.max_uses_per_customer != null ? String(c.max_uses_per_customer) : '',
      min_order: c?.min_order ? majorFromMinor(c.min_order) : '',
      combinable: c?.combinable ?? false,
      active: c?.active ?? true,
      product_ids: c?.scope?.type === 'product' ? [...ids] : [],
      category_ids: c?.scope?.type === 'category' ? [...ids] : [],
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
      // A coupon covers either chosen products or chosen categories; products win when both are set.
      const scope = x.product_ids.length ? { type: 'product', ids: x.product_ids } : x.category_ids.length ? { type: 'category', ids: x.category_ids } : { type: 'order' };
      const body = {
        code: x.code.trim(), kind: x.kind, value: x.kind === 'percent' ? Math.round(Number(x.value || 0) * 100) : minorFromInput(x.value), scope,
        valid_from: x.valid_from ? fromLocalInput(x.valid_from) : null, valid_until: x.valid_until ? fromLocalInput(x.valid_until) : null,
        max_uses: num(x.max_uses), max_uses_per_customer: num(x.max_uses_per_customer), min_order: x.min_order ? minorFromInput(x.min_order) : 0,
        combinable: x.combinable, active: x.active,
      };
      if (x.id) await api.patch(`/coupons/${x.id}`, body);
      else await api.post('/coupons', body);
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

  async function toggle(c: any, active: boolean) {
    try {
      await api.patch(`/coupons/${c.id}`, { active });
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function remove(c: any) {
    if (!(await confirmAction({ title: t('pricing.coupon_delete_title', { code: c.code }), description: t('pricing.coupon_delete_description'), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`/coupons/${c.id}`);
      toast.success(t('common.removed'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <p class="text-muted-foreground max-w-2xl text-sm">{t('pricing.coupons_hint')}</p>
    {#if canEdit}<Button onclick={() => open(null)}><PlusIcon />{t('pricing.coupon_new')}</Button>{/if}
  </div>
  {#if !coupons}
    <Spinner />
  {:else if !coupons.length}
    <Empty.Root class="border">
      <Empty.Header>
        <Empty.Media variant="icon"><TicketIcon /></Empty.Media>
        <Empty.Title>{t('pricing.coupons_empty')}</Empty.Title>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <Card.Root class="py-0">
      <Table.Root data-testid="coupons">
        <Table.Header>
          <Table.Row>
            <Table.Head>{t('pricing.code')}</Table.Head>
            <Table.Head class="text-right">{t('pricing.value')}</Table.Head>
            <Table.Head>{t('pricing.valid')}</Table.Head>
            <Table.Head class="text-right">{t('pricing.uses')}</Table.Head>
            <Table.Head>{t('pricing.active')}</Table.Head>
            <Table.Head class="w-24"><span class="sr-only">{t('common.more_actions')}</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each coupons as c (c.id)}
            <Table.Row data-testid="coupon-row">
              <Table.Cell class="font-mono font-medium">
                {c.code}
                {#if c.combinable}<Badge variant="outline" class="ml-1.5 font-sans">{t('pricing.combinable')}</Badge>{/if}
              </Table.Cell>
              <Table.Cell class="text-right tabular-nums">{value(c)}</Table.Cell>
              <Table.Cell class="text-muted-foreground">{c.valid_from || c.valid_until ? `${c.valid_from ? d(c.valid_from) : '…'} – ${c.valid_until ? d(c.valid_until) : '…'}` : t('pricing.always')}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{c.max_uses ? `${c.uses_count} / ${c.max_uses}` : c.uses_count}</Table.Cell>
              <Table.Cell><Switch checked={c.active} disabled={!canEdit} aria-label={t('pricing.active_label', { name: c.code })} onCheckedChange={(v) => toggle(c, v)} /></Table.Cell>
              <Table.Cell class="text-right">
                {#if canEdit}
                  <Button variant="ghost" size="icon-sm" aria-label={t('pricing.coupon_edit', { code: c.code })} onclick={() => open(c)}><PencilIcon /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t('pricing.coupon_delete_title', { code: c.code })} onclick={() => remove(c)}><Trash2Icon /></Button>
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
          <Dialog.Title>{edit.id ? t('pricing.coupon_edit', { code: edit.code }) : t('pricing.coupon_new')}</Dialog.Title>
        </Dialog.Header>
        <Field.Group>
          <div class="grid gap-4 sm:grid-cols-[1fr_auto_8rem]">
            <Field.Field data-invalid={!!errors.code || undefined}>
              <Field.Label for="cp-code">{t('pricing.code')}</Field.Label>
              <Input id="cp-code" class="font-mono uppercase" bind:value={edit.code} aria-invalid={!!errors.code} />
              {#if errors.code}<Field.Error>{errors.code}</Field.Error>{/if}
            </Field.Field>
            <Field.Field>
              <Field.Label for="cp-kind">{t('pricing.coupon_kind')}</Field.Label>
              <NativeSelect id="cp-kind" bind:value={edit.kind}>
                <NativeSelectOption value="percent">{t('pricing.coupon_percent')}</NativeSelectOption>
                <NativeSelectOption value="fixed">{t('pricing.coupon_fixed', { currency })}</NativeSelectOption>
              </NativeSelect>
            </Field.Field>
            <Field.Field data-invalid={!!errors.value || undefined}>
              <Field.Label for="cp-value">{t('pricing.value')}</Field.Label>
              <Input id="cp-value" type="number" min="0" step="0.01" bind:value={edit.value} aria-invalid={!!errors.value} />
              {#if errors.value}<Field.Error>{errors.value}</Field.Error>{/if}
            </Field.Field>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field data-invalid={!!errors.valid_from || undefined}>
              <Field.Label for="cp-from">{t('pricing.valid_from')}</Field.Label>
              <Input id="cp-from" type="datetime-local" bind:value={edit.valid_from} aria-invalid={!!errors.valid_from} />
              {#if errors.valid_from}<Field.Error>{errors.valid_from}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.valid_until || undefined}>
              <Field.Label for="cp-until">{t('pricing.valid_until')}</Field.Label>
              <Input id="cp-until" type="datetime-local" bind:value={edit.valid_until} aria-invalid={!!errors.valid_until} />
              {#if errors.valid_until}<Field.Error>{errors.valid_until}</Field.Error>{/if}
            </Field.Field>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <Field.Field data-invalid={!!errors.max_uses || undefined}>
              <Field.Label for="cp-max">{t('pricing.max_uses')}</Field.Label>
              <Input id="cp-max" type="number" min="1" bind:value={edit.max_uses} aria-invalid={!!errors.max_uses} />
            </Field.Field>
            <Field.Field data-invalid={!!errors.max_uses_per_customer || undefined}>
              <Field.Label for="cp-max-c">{t('pricing.max_uses_per_customer')}</Field.Label>
              <Input id="cp-max-c" type="number" min="1" bind:value={edit.max_uses_per_customer} aria-invalid={!!errors.max_uses_per_customer} />
            </Field.Field>
            <Field.Field data-invalid={!!errors.min_order || undefined}>
              <Field.Label for="cp-min">{t('pricing.min_order', { currency })}</Field.Label>
              <Input id="cp-min" type="number" min="0" step="0.01" bind:value={edit.min_order} aria-invalid={!!errors.min_order} />
            </Field.Field>
          </div>
          <ScopePicker idPrefix="cp" bind:productIds={edit.product_ids} bind:categoryIds={edit.category_ids} />
          <Field.Field orientation="horizontal">
            <Switch id="cp-comb" bind:checked={edit.combinable} />
            <Field.Label for="cp-comb" class="font-normal">{t('pricing.combinable_label')}</Field.Label>
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch id="cp-active" bind:checked={edit.active} />
            <Field.Label for="cp-active" class="font-normal">{t('pricing.active')}</Field.Label>
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
