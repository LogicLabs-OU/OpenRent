<script lang="ts">
  import { onMount } from 'svelte';
  import * as Alert from '@openrent/ui/alert';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import { Button } from '@openrent/ui/button';
  import { Textarea } from '@openrent/ui/textarea';
  import { Spinner } from '@openrent/ui/spinner';
  import { Money } from '@openrent/ui/openrent';
  import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
  import { api, t, toast, notifyError, rel, dt, session } from '#lib';

  /**
   * A customer's pending request to keep the booking longer (FR-CUS-6). The price and availability of the
   * requested return are checked with a dry run; approving extends the order.
   */
  let { order, ondecided }: { order: any; ondecided?: () => void } = $props();
  let request = $state<any>(null);
  let preview = $state<any>(null);
  let declining = $state(false);
  let note = $state('');
  let busy = $state(false);

  async function load() {
    request = (await api.get(`/orders/${order.id}/extension_request`)).request;
    preview = request?.status === 'pending' ? await api.post(`/orders/${order.id}/actions/extend`, { ends_at: request.requested_ends_at, dry_run: true }).catch(() => null) : null;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  async function decide(approve: boolean) {
    busy = true;
    try {
      await api.post(`/extension_requests/${request.id}/actions/${approve ? 'approve' : 'decline'}`, approve ? {} : { note });
      toast.success(t(approve ? 'extension.approved' : 'extension.declined'));
      declining = false;
      await load();
      ondecided?.();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if request?.status === 'pending'}
  <Alert.Root class="mb-6 border-amber-500/40 bg-amber-50 dark:bg-amber-950" data-testid="extension-request">
    <CalendarClockIcon />
    <Alert.Title>{t('extension.title')}</Alert.Title>
    <Alert.Description class="flex flex-col gap-3">
      <p>{t('extension.description', { when: rel(request.created_at), until: dt(request.requested_ends_at, order.timezone), reason: request.reason || t('cancellation.no_reason') })}</p>
      {#if preview}
        <p>
          {#if preview.available}{t('extension.would_cost')} <Money value={preview.amount} />{:else}{t('extension.unavailable')}{/if}
        </p>
      {/if}
      {#if session.can('orders:write')}
        <div class="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !preview?.available} onclick={() => decide(true)}>{#if busy}<Spinner />{/if}{t('extension.approve')}</Button>
          <Button size="sm" variant="outline" onclick={() => (declining = true)}>{t('extension.decline')}</Button>
        </div>
      {/if}
    </Alert.Description>
  </Alert.Root>
{/if}

<Dialog.Root bind:open={declining}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('extension.decline_title')}</Dialog.Title>
      <Dialog.Description>{t('extension.decline_hint')}</Dialog.Description>
    </Dialog.Header>
    <Field.Field>
      <Field.Label for="xr-note">{t('cancellation.note')}</Field.Label>
      <Textarea id="xr-note" bind:value={note} maxlength={1000} />
    </Field.Field>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (declining = false)}>{t('common.cancel')}</Button>
      <Button disabled={busy} onclick={() => decide(false)}>{#if busy}<Spinner />{/if}{t('extension.decline')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
