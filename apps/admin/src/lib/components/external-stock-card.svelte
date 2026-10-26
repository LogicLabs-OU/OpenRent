<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Dialog from '@openrent/ui/dialog';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { formatMoney } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { api, t, toast, notifyError, fieldErrors, session, dt, fromLocalInput, minorFromInput, confirmAction, ApiError } from '#lib';

  /**
   * Stock rented in from a supplier for some dates (FR-CAT-9): it adds to what can be booked then only.
   * Overbookings it covers are settled when it is added.
   */
  let { variants }: { variants: { id: string; name: string; tracking: string }[] } = $props();
  const tracked = $derived(variants.filter((v) => v.tracking !== 'none'));
  let rows = $state<any[]>([]);
  let open = $state(false);
  let f = $state({ variant_id: '', location_id: '', supplier: '', quantity: '1', starts: '', ends: '', unit_cost: '', reference: '' });
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  async function load() {
    const all = await Promise.all(tracked.map((v) => api.get(`/external_stock?variant_id=${v.id}&status=booked`)));
    rows = all.flatMap((r) => r.data).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  $effect(() => {
    void tracked.length;
    load().catch(notifyError);
  });

  function start() {
    f = { variant_id: tracked[0]?.id ?? '', location_id: session.locationId || session.locations[0]?.id || '', supplier: '', quantity: '1', starts: '', ends: '', unit_cost: '', reference: '' };
    errors = {};
    open = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      const r = await api.post('/external_stock', {
        variant_id: f.variant_id, location_id: f.location_id, supplier: f.supplier, quantity: Number(f.quantity), starts_at: fromLocalInput(f.starts), ends_at: fromLocalInput(f.ends),
        unit_cost: f.unit_cost ? minorFromInput(f.unit_cost) : 0, reference: f.reference || null,
      });
      toast.success(r.overbookings_resolved ? t('external.saved_resolved', { count: r.overbookings_resolved }) : t('external.saved'));
      open = false;
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function cancel(x: any) {
    if (!(await confirmAction({ title: t('external.cancel_title'), description: t('external.cancel_text', { supplier: x.supplier }), confirmLabel: t('external.cancel') }))) return;
    try {
      await api.post(`/external_stock/${x.id}/actions/cancel`, {});
    } catch (err) {
      // Bookings need it: staff may still cancel on purpose.
      if (!(err instanceof ApiError && err.code === 'external_stock_in_use')) return notifyError(err);
      if (!(await confirmAction({ title: t('external.cancel_title'), description: err.message, confirmLabel: t('external.cancel_anyway'), destructive: true }))) return;
      await api.post(`/external_stock/${x.id}/actions/cancel`, { force: true }).catch(notifyError);
    }
    await load().catch(notifyError);
  }
</script>

{#if tracked.length}
  <Card.Root data-testid="external-stock">
    <Card.Header>
      <Card.Title>{t('external.title')}</Card.Title>
      <Card.Description>{t('external.description')}</Card.Description>
      {#if session.can('inventory:write')}<Card.Action><Button size="sm" variant="outline" onclick={start}><PlusIcon />{t('external.add')}</Button></Card.Action>{/if}
    </Card.Header>
    <Card.Content>
      {#if rows.length}
        <ul class="flex flex-col divide-y text-sm">
          {#each rows as x (x.id)}
            <li class="flex flex-wrap items-center gap-2 py-2">
              <Badge variant="secondary">× {x.quantity}</Badge>
              <span class="font-medium">{x.supplier}</span>
              <span class="text-muted-foreground">{dt(x.starts_at)} – {dt(x.ends_at)}{#if x.total_cost.amount} · {formatMoney(x.total_cost)}{/if}</span>
              {#if session.can('inventory:write')}<Button size="sm" variant="ghost" class="ml-auto" onclick={() => cancel(x)}>{t('external.cancel')}</Button>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-muted-foreground">{t('external.none')}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <Dialog.Root bind:open>
    <Dialog.Content>
      <form class="flex flex-col gap-4" onsubmit={save}>
        <Dialog.Header><Dialog.Title>{t('external.add')}</Dialog.Title></Dialog.Header>
        <Field.Group>
          {#if tracked.length > 1}
            <Field.Field>
              <Field.Label for="ext-variant">{t('product.variants')}</Field.Label>
              <NativeSelect.Root id="ext-variant" class="w-full" bind:value={f.variant_id}>{#each tracked as v (v.id)}<NativeSelect.Option value={v.id}>{v.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
            </Field.Field>
          {/if}
          {#if session.locations.length > 1}
            <Field.Field>
              <Field.Label for="ext-loc">{t('field.location')}</Field.Label>
              <NativeSelect.Root id="ext-loc" class="w-full" bind:value={f.location_id}>{#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
            </Field.Field>
          {/if}
          <Field.Field data-invalid={!!errors.supplier || undefined}>
            <Field.Label for="ext-supplier">{t('external.supplier')}</Field.Label>
            <Input id="ext-supplier" bind:value={f.supplier} aria-invalid={!!errors.supplier} />
            {#if errors.supplier}<Field.Error>{errors.supplier}</Field.Error>{/if}
          </Field.Field>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field data-invalid={!!errors.quantity || undefined}>
              <Field.Label for="ext-qty">{t('field.quantity')}</Field.Label>
              <Input id="ext-qty" type="number" min="1" bind:value={f.quantity} aria-invalid={!!errors.quantity} />
              {#if errors.quantity}<Field.Error>{errors.quantity}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.unit_cost || undefined}>
              <Field.Label for="ext-cost">{t('external.unit_cost')}</Field.Label>
              <Input id="ext-cost" inputmode="decimal" bind:value={f.unit_cost} aria-invalid={!!errors.unit_cost} />
              {#if errors.unit_cost}<Field.Error>{errors.unit_cost}</Field.Error>{/if}
            </Field.Field>
            <Field.Field>
              <Field.Label for="ext-from">{t('external.from')}</Field.Label>
              <Input id="ext-from" type="datetime-local" bind:value={f.starts} required />
            </Field.Field>
            <Field.Field data-invalid={!!errors.ends_at || undefined}>
              <Field.Label for="ext-to">{t('external.to')}</Field.Label>
              <Input id="ext-to" type="datetime-local" bind:value={f.ends} required aria-invalid={!!errors.ends_at} />
              {#if errors.ends_at}<Field.Error>{errors.ends_at}</Field.Error>{/if}
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="ext-ref">{t('external.reference')}</Field.Label>
            <Input id="ext-ref" bind:value={f.reference} />
          </Field.Field>
        </Field.Group>
        <Dialog.Footer><Button type="submit" disabled={busy}>{t('common.save')}</Button></Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
{/if}
