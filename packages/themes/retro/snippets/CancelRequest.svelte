<script lang="ts">
  import { getRuntime, RuntimeError, type CancellationRequest } from '@openrent/theme-sdk';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { toast } from 'svelte-sonner';
  import { outline, solid } from '../lib/retro.ts';

  /** Ask the shop to cancel a booking, or show the answer. `token` is set on the order page. */
  let {
    order,
    request,
    can,
    size = 'sm',
  }: {
    order: { id: string; token?: string };
    request: CancellationRequest | null | undefined;
    can: boolean;
    size?: 'sm' | 'default';
  } = $props();
  const rt = getRuntime();
  let open = $state(false);
  let reason = $state('');
  let busy = $state(false);
  let error = $state('');

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!rt.account) return;
    busy = true;
    error = '';
    try {
      await rt.account.requestCancellation(order, reason);
      open = false;
      toast.success(rt.t('cancel.sent'));
    } catch (err) {
      if (err instanceof RuntimeError && err.fields.reason) error = err.fields.reason;
      else toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function withdraw() {
    try {
      await rt.account?.withdrawCancellation(order);
      toast.success(rt.t('cancel.withdrawn'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
</script>

{#if request?.status === 'pending'}
  <div class="flex flex-wrap items-center gap-2" data-testid="cancellation-status">
    <Badge
      variant="outline"
      class="rounded-full border-black bg-(--retro-highlight) px-3 py-1 text-sm font-normal text-(--retro-highlight-ink)"
      >{rt.t('cancel.pending')}</Badge
    >
    <Button variant="link" class="h-auto p-0 text-sm" onclick={withdraw}>{rt.t('cancel.withdraw')}</Button>
  </div>
{:else}
  {#if request?.status === 'declined'}
    <p class="text-muted-foreground text-sm" data-testid="cancellation-status">
      {rt.t('cancel.declined')}{request.decision_note ? `: ${request.decision_note}` : ''}
    </p>
  {/if}
  {#if can && rt.account}
    <Dialog.Root bind:open>
      <Dialog.Trigger>
        {#snippet child({ props })}<Button
            {...props}
            variant="outline"
            class={[outline, size === 'sm' && 'h-10 px-4']}>{rt.t('cancel.request')}</Button
          >{/snippet}
      </Dialog.Trigger>
      <Dialog.Content class="rounded-[0.25rem] shadow-[6px_6px_0_0_#000] ring-1 ring-black">
        <form class="flex flex-col gap-4" onsubmit={send}>
          <Dialog.Header>
            <Dialog.Title class="text-2xl font-normal">{rt.t('cancel.title')}</Dialog.Title>
            <Dialog.Description>{rt.t('cancel.hint')}</Dialog.Description>
          </Dialog.Header>
          <Field.Field data-invalid={!!error || undefined}>
            <Field.Label for="or-cancel-reason">{rt.t('cancel.reason')}</Field.Label>
            <Textarea
              id="or-cancel-reason"
              class="bg-white"
              maxlength={1000}
              bind:value={reason}
              aria-invalid={!!error}
            />
            {#if error}<Field.Error>{error}</Field.Error>{/if}
          </Field.Field>
          <Dialog.Footer>
            <Dialog.Close>
              {#snippet child({ props })}<Button {...props} variant="outline" type="button" class={outline}
                  >{rt.t('cancel.keep')}</Button
                >{/snippet}
            </Dialog.Close>
            <Button type="submit" class={solid} disabled={busy}
              >{#if busy}<Spinner />{/if}{rt.t('cancel.send')}</Button
            >
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  {/if}
{/if}
