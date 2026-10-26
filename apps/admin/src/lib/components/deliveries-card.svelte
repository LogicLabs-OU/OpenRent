<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { StatusBadge } from '@openrent/ui/openrent';
  import TruckIcon from '@lucide/svelte/icons/truck';
  import { api, t, toast, notifyError, fieldErrors, session, dt, toLocalInput, fromLocalInput } from '#lib';
  import { to } from '#lib/nav.ts';

  /** The order's deliveries and collections (FR-OR-12), and booking a new one. */
  let { order, onchange }: { order: any; onchange?: () => void } = $props();
  let list = $state<any[]>([]);
  let booking = $state<{ kind: 'delivery' | 'collection'; start: string; end: string; line1: string; postal_code: string; city: string; notes: string } | null>(null);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  const canEdit = $derived(session.can('deliveries:write'));
  const active = (kind: string) => list.some((d) => d.kind === kind && ['scheduled', 'dispatched'].includes(d.status));

  async function load() {
    list = (await api.get(`/deliveries?order_id=${order.id}`)).data;
  }
  onMount(() => {
    if (session.can('deliveries:read')) load().catch(notifyError);
  });

  function open(kind: 'delivery' | 'collection') {
    errors = {};
    // A delivery arrives in the two hours before pickup; a collection in the two hours after the return.
    const at = new Date(kind === 'delivery' ? order.starts_at : order.ends_at);
    const start = kind === 'delivery' ? new Date(at.getTime() - 2 * 3600_000) : at;
    const end = kind === 'delivery' ? at : new Date(at.getTime() + 2 * 3600_000);
    const a = order.customer?.addresses?.shipping ?? order.customer?.addresses?.billing ?? {};
    booking = { kind, start: toLocalInput(start, order.timezone), end: toLocalInput(end, order.timezone), line1: a.line1 ?? '', postal_code: a.postal_code ?? '', city: a.city ?? '', notes: '' };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!booking) return;
    saving = true;
    errors = {};
    try {
      const b = booking;
      await api.post(`/orders/${order.id}/deliveries`, {
        kind: b.kind, window_start: fromLocalInput(b.start, order.timezone), window_end: fromLocalInput(b.end, order.timezone),
        address: { line1: b.line1, postal_code: b.postal_code, city: b.city }, notes: b.notes,
      });
      toast.success(t(b.kind === 'delivery' ? 'deliveries.delivery_booked' : 'deliveries.collection_booked'));
      booking = null;
      await load();
      onchange?.();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }
</script>

{#if session.can('deliveries:read')}
  <Card.Root data-testid="order-deliveries">
    <Card.Header>
      <Card.Title>{t('nav.deliveries')}</Card.Title>
      <Card.Description>{t('deliveries.order_hint')}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3 text-sm">
      {#each list as d (d.id)}
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant={d.kind === 'delivery' ? 'default' : 'secondary'}>{t(`deliveries.kind.${d.kind}` as any)}</Badge>
          <a class="hover:underline" href={to(`/deliveries?date=${d.route_date}`)}>{dt(d.window_start, order.timezone)} – {dt(d.window_end, order.timezone, { timeStyle: 'short' })}</a>
          <StatusBadge status={d.status} label={t(`deliveries.status.${d.status}` as any)} />
        </div>
      {:else}
        <p class="text-muted-foreground">{t('deliveries.none')}</p>
      {/each}
    </Card.Content>
    {#if canEdit && (!active('delivery') || !active('collection'))}
      <Card.Footer class="flex flex-wrap gap-2">
        {#if !active('delivery') && ['quote', 'reserved', 'prepared'].includes(order.status)}<Button size="sm" variant="outline" onclick={() => open('delivery')}><TruckIcon />{t('deliveries.book_delivery')}</Button>{/if}
        {#if !active('collection') && ['quote', 'reserved', 'prepared', 'out', 'returned_partial'].includes(order.status)}<Button size="sm" variant="outline" onclick={() => open('collection')}><TruckIcon />{t('deliveries.book_collection')}</Button>{/if}
      </Card.Footer>
    {/if}
  </Card.Root>
{/if}

<Dialog.Root open={!!booking} onOpenChange={(v) => !v && (booking = null)}>
  <Dialog.Content>
    {#if booking}
      <form class="flex flex-col gap-4" onsubmit={save} novalidate>
        <Dialog.Header>
          <Dialog.Title>{t(booking.kind === 'delivery' ? 'deliveries.book_delivery' : 'deliveries.book_collection')}</Dialog.Title>
          <Dialog.Description>{t('deliveries.window_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field data-invalid={!!errors.window_start || undefined}>
              <Field.Label for="dlb-start">{t('deliveries.window_start')}</Field.Label>
              <Input id="dlb-start" type="datetime-local" bind:value={booking.start} aria-invalid={!!errors.window_start} />
              {#if errors.window_start}<Field.Error>{errors.window_start}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.window_end || undefined}>
              <Field.Label for="dlb-end">{t('deliveries.window_end')}</Field.Label>
              <Input id="dlb-end" type="datetime-local" bind:value={booking.end} aria-invalid={!!errors.window_end} />
              {#if errors.window_end}<Field.Error>{errors.window_end}</Field.Error>{/if}
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="dlb-line1">{t('deliveries.street')}</Field.Label>
            <Input id="dlb-line1" autocomplete="off" bind:value={booking.line1} />
          </Field.Field>
          <div class="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field.Field>
              <Field.Label for="dlb-zip">{t('deliveries.postal_code')}</Field.Label>
              <Input id="dlb-zip" bind:value={booking.postal_code} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="dlb-city">{t('deliveries.city')}</Field.Label>
              <Input id="dlb-city" bind:value={booking.city} />
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="dlb-notes">{t('deliveries.notes')}</Field.Label>
            <Textarea id="dlb-notes" bind:value={booking.notes} />
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (booking = null)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
