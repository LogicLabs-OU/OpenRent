<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';

  /** Replace a unit that is out with another one of the same item (FR-OR-10). */
  let { orderId, unit, open = $bindable(false), ondone }: { orderId: string; unit: { stock_item_id: string; barcode: string } | null; open?: boolean; ondone?: () => void } = $props();
  let barcode = $state('');
  let status = $state<'needs_inspection' | 'soft_down' | 'hard_down'>('needs_inspection');
  let reason = $state('');
  let saving = $state(false);
  let errors = $state<Record<string, string>>({});

  $effect(() => {
    if (open) {
      barcode = '';
      status = 'needs_inspection';
      reason = '';
      errors = {};
    }
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!unit) return;
    saving = true;
    errors = {};
    try {
      await api.post(`/orders/${orderId}/actions/swap_unit`, { from_stock_item_id: unit.stock_item_id, to_barcode: barcode.trim() || undefined, old_status: status, reason: reason.trim() || undefined });
      toast.success(t('swap.done', { from: unit.barcode, to: barcode.trim() }));
      open = false;
      ondone?.();
    } catch (err) {
      errors = fieldErrors(err);
      if (errors.to_stock_item_id) errors.to_barcode = errors.to_stock_item_id;
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    {#if unit}
      <form class="flex flex-col gap-4" onsubmit={save} novalidate>
        <Dialog.Header>
          <Dialog.Title>{t('swap.title', { code: unit.barcode })}</Dialog.Title>
          <Dialog.Description>{t('swap.hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.to_barcode || undefined}>
            <Field.Label for="sw-code">{t('swap.replacement')}</Field.Label>
            <Input id="sw-code" class="font-mono" autocomplete="off" bind:value={barcode} aria-invalid={!!errors.to_barcode} />
            {#if errors.to_barcode}<Field.Error>{errors.to_barcode}</Field.Error>{:else}<Field.Description>{t('swap.replacement_hint')}</Field.Description>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="sw-status">{t('swap.old_status', { code: unit.barcode })}</Field.Label>
            <NativeSelect id="sw-status" class="w-full" bind:value={status}>
              {#each ['needs_inspection', 'soft_down', 'hard_down'] as s (s)}<NativeSelectOption value={s}>{t(`status.${s}` as any)}</NativeSelectOption>{/each}
            </NativeSelect>
          </Field.Field>
          <Field.Field>
            <Field.Label for="sw-reason">{t('swap.reason')}</Field.Label>
            <Input id="sw-reason" bind:value={reason} />
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving || !barcode.trim()}>{#if saving}<Spinner />{/if}{t('swap.confirm')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
