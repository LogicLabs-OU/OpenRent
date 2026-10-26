<script lang="ts">
  import { getRuntime, formatTime, RuntimeError, type ExtensionRequest } from '@openrent/theme-sdk';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { toast } from 'svelte-sonner';

  /** Ask to keep a booking longer (theme API 1.5), or show the answer. `token` is set on the order page. */
  let {
    order,
    endsAt,
    request,
    can,
    size = 'sm',
  }: { order: { id: string; token?: string }; endsAt: string; request: ExtensionRequest | null | undefined; can: boolean; size?: 'sm' | 'default' } = $props();
  const rt = getRuntime();
  let open = $state(false);
  // svelte-ignore state_referenced_locally
  let date = $state(rt.zone.localDate(endsAt));
  let time = $state('');
  let reason = $state('');
  let busy = $state(false);
  let error = $state('');
  const times = $derived(date ? rt.zone.timeOptions(date) : []);
  $effect(() => {
    if (times.length && !times.includes(time)) time = times[times.length - 1]!;
  });

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!rt.account?.requestExtension) return;
    error = '';
    if (!times.length) {
      error = rt.t('dates.closed');
      return;
    }
    busy = true;
    try {
      await rt.account.requestExtension(order, rt.zone.toInstant(date, time), reason);
      open = false;
      toast.success(rt.t('extend.sent'));
    } catch (err) {
      if (err instanceof RuntimeError && (err.fields.ends_at || err.fields.reason)) error = err.fields.ends_at ?? err.fields.reason!;
      else toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function withdraw() {
    try {
      await rt.account?.withdrawExtension?.(order);
      toast.success(rt.t('extend.withdrawn'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
</script>

{#if request?.status === 'pending'}
  <div class="flex flex-wrap items-center gap-2" data-testid="extension-status">
    <Badge variant="outline" class="border-amber-400/30 bg-amber-400/10 text-amber-200">{rt.t('extend.pending', { date: rt.format.datetime(request.requested_ends_at) })}</Badge>
    <Button variant="link" class="h-auto p-0 text-sm text-[color:var(--nf-accent-text)]" onclick={withdraw}>{rt.t('extend.withdraw')}</Button>
  </div>
{:else}
  {#if request?.status === 'declined'}
    <p class="text-muted-foreground text-sm" data-testid="extension-status">{rt.t('extend.declined')}{request.decision_note ? `: ${request.decision_note}` : ''}</p>
  {/if}
  {#if can && rt.account?.requestExtension}
    <Dialog.Root bind:open>
      <Dialog.Trigger>
        {#snippet child({ props })}<Button {...props} variant="outline" class="rounded-full" {size}>{rt.t('extend.request')}</Button>{/snippet}
      </Dialog.Trigger>
      <Dialog.Content>
        <form class="flex flex-col gap-4" onsubmit={send}>
          <Dialog.Header>
            <Dialog.Title>{rt.t('extend.title')}</Dialog.Title>
            <Dialog.Description>{rt.t('extend.hint', { date: rt.format.datetime(endsAt) })}</Dialog.Description>
          </Dialog.Header>
          <div class="grid grid-cols-2 gap-3">
            <Field.Field data-invalid={!!error || undefined}>
              <Field.Label for="or-extend-date">{rt.t('extend.new_return')}</Field.Label>
              <Input id="or-extend-date" type="date" min={rt.zone.localDate(endsAt)} required bind:value={date} aria-invalid={!!error} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="or-extend-time">{rt.t('dates.return_time')}</Field.Label>
              <NativeSelect id="or-extend-time" class="w-full" bind:value={time} disabled={!times.length}>
                {#each times as x (x)}<NativeSelectOption value={x}>{formatTime(x, rt.shop.locale)}</NativeSelectOption>{:else}<NativeSelectOption value="">{rt.t('dates.closed_short')}</NativeSelectOption>{/each}
              </NativeSelect>
            </Field.Field>
            {#if error}<Field.Error class="col-span-2">{error}</Field.Error>{/if}
          </div>
          <Field.Field>
            <Field.Label for="or-extend-reason">{rt.t('extend.reason')}</Field.Label>
            <Textarea id="or-extend-reason" maxlength={1000} bind:value={reason} />
          </Field.Field>
          <Dialog.Footer>
            <Dialog.Close>
              {#snippet child({ props })}<Button {...props} variant="outline" type="button">{rt.t('extend.keep')}</Button>{/snippet}
            </Dialog.Close>
            <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{rt.t('extend.send')}</Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  {/if}
{/if}
