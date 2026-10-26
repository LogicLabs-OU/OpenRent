<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { api, t, toast, notifyError, fieldErrors, toLocalInput, fromLocalInput, dt } from '#lib';
  import { Money } from '@openrent/ui/openrent';

  /**
   * Keep a rental longer or bring its return forward (FR-OR-9). Each new time is checked with a dry run
   * first, so staff see availability and the price difference before confirming.
   */
  let { order, mode, open = $bindable(false), ondone }: { order: any; mode: 'extend' | 'return_early'; open?: boolean; ondone?: () => void } = $props();
  let when = $state('');
  let credit = $state(true);
  let preview = $state<any>(null);
  let checking = $state(false);
  let saving = $state(false);
  let errors = $state<Record<string, string>>({});
  const path = $derived(`/orders/${order.id}/actions/${mode}`);

  $effect(() => {
    if (open) {
      when = toLocalInput(order.ends_at, order.timezone);
      credit = true;
      preview = null;
      errors = {};
    }
  });

  async function check() {
    if (!when) return;
    checking = true;
    errors = {};
    try {
      preview = await api.post(path, { ends_at: fromLocalInput(when, order.timezone), dry_run: true, credit });
    } catch (err) {
      preview = null;
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      checking = false;
    }
  }

  async function confirm(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    errors = {};
    try {
      await api.post(path, { ends_at: fromLocalInput(when, order.timezone), credit });
      toast.success(t(mode === 'extend' ? 'end_change.extended' : 'end_change.shortened'));
      open = false;
      ondone?.();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <form class="flex flex-col gap-4" onsubmit={confirm} novalidate>
      <Dialog.Header>
        <Dialog.Title>{t(mode === 'extend' ? 'end_change.extend_title' : 'end_change.return_title', { number: order.number })}</Dialog.Title>
        <Dialog.Description>{t('end_change.current', { date: dt(order.ends_at, order.timezone) })}</Dialog.Description>
      </Dialog.Header>
      <Field.Group>
        <Field.Field data-invalid={!!errors.ends_at || undefined}>
          <Field.Label for="ec-when">{t('end_change.new_return')}</Field.Label>
          <Input id="ec-when" type="datetime-local" bind:value={when} onchange={check} aria-invalid={!!errors.ends_at} />
          {#if errors.ends_at}<Field.Error>{errors.ends_at}</Field.Error>{/if}
        </Field.Field>
        {#if mode === 'return_early'}
          <Field.Field orientation="horizontal">
            <Switch id="ec-credit" bind:checked={credit} onCheckedChange={check} />
            <Field.Label for="ec-credit" class="font-normal">{t('end_change.credit')}</Field.Label>
          </Field.Field>
        {/if}
      </Field.Group>
      {#if checking}
        <Spinner />
      {:else if preview}
        {#if preview.available}
          <Alert.Root data-testid="end-change-preview">
            <CircleCheckIcon />
            <Alert.Title>{t('end_change.available')}</Alert.Title>
            <Alert.Description>
              {#if preview.amount.amount}{t(mode === 'extend' ? 'end_change.charge' : 'end_change.refund')} <Money value={{ ...preview.amount, amount: Math.abs(preview.amount.amount) }} />{:else}{t('end_change.no_charge')}{/if}
            </Alert.Description>
          </Alert.Root>
        {:else}
          <Alert.Root variant="destructive" data-testid="end-change-preview">
            <CircleAlertIcon />
            <Alert.Title>{t('end_change.unavailable')}</Alert.Title>
            <Alert.Description>{preview.problem?.message}</Alert.Description>
          </Alert.Root>
        {/if}
      {/if}
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving || !preview?.available}>{#if saving}<Spinner />{/if}{t(mode === 'extend' ? 'end_change.extend' : 'end_change.return_early')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
