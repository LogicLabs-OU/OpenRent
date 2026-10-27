<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { StatusBadge, PageHeader } from '@openrent/ui/openrent';
  import TruckIcon from '@lucide/svelte/icons/truck';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import MapPinIcon from '@lucide/svelte/icons/map-pin';
  import PhoneIcon from '@lucide/svelte/icons/phone';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { api, download, t, toast, notifyError, fieldErrors, session, dt } from '#lib';
  import { to } from '#lib/nav.ts';

  /**
   * The day board for deliveries and collections (FR-OR-12): the run in order, drivers, and the steps at
   * the door. "My run" shows only the signed-in driver's stops, for phones.
   */
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: session.tz }).format(new Date());
  let date = $state(new URLSearchParams(location.search).get('date') ?? today());
  let mine = $state(new URLSearchParams(location.search).get('mine') === '1');
  let list = $state<any[] | null>(null);
  let drivers = $state<{ id: string; name: string }[]>([]);
  let completing = $state<any>(null);
  let signedName = $state('');
  let failing = $state<any>(null);
  let reason = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const canEdit = $derived(session.can('deliveries:write'));

  async function load() {
    const q = new URLSearchParams({ date });
    if (session.locationId) q.set('location_id', session.locationId);
    if (mine && session.me) q.set('driver_user_id', session.me.user.id);
    list = (await api.get(`/deliveries?${q}`)).data.filter((d: any) => d.status !== 'cancelled');
  }
  onMount(() => {
    load().catch(notifyError);
    if (session.can('users:read')) api.get('/users').then((r) => (drivers = r.data.map((u: any) => ({ id: u.id, name: u.name || u.email }))), () => undefined);
  });

  async function run(fn: () => Promise<unknown>, message: string) {
    busy = true;
    try {
      await fn();
      toast.success(message);
      await load();
      return true;
    } catch (e) {
      notifyError(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function move(i: number, by: number) {
    if (!list) return;
    const ids = list.map((d) => d.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await run(() => api.post('/deliveries/actions/reorder', { date, ids }), t('deliveries.reordered'));
  }

  async function complete(e: SubmitEvent) {
    e.preventDefault();
    if (await run(() => api.post(`/deliveries/${completing.id}/actions/complete`, { signed_name: signedName.trim() || undefined }), t('deliveries.completed'))) completing = null;
  }

  async function fail(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    busy = true;
    try {
      await api.post(`/deliveries/${failing.id}/actions/fail`, { reason });
      toast.success(t('deliveries.failed_saved'));
      failing = null;
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  const addressText = (a: any) => [a?.line1, a?.line2, a?.postal_code, a?.city].filter(Boolean).join(', ');
  // The geocoder's point when the shop has one (FR-PR-8), else coordinates typed in, else a search.
  const mapUrl = (d: any) => {
    const p = d.map ?? (Number.isFinite(Number(d.address?.lat)) ? { lat: d.address.lat, lon: d.address.lng } : null);
    return p ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}` : `https://www.openstreetmap.org/search?query=${encodeURIComponent(addressText(d.address))}`;
  };
  const time = (iso: string) => dt(iso, session.tz, { timeStyle: 'short' });
</script>

<svelte:head><title>{t('nav.deliveries')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.deliveries')} description={t('deliveries.description')}>
  {#snippet actions()}
    <Button variant="outline" onclick={() => download(`/deliveries/route?date=${date}${mine && session.me ? `&driver_user_id=${session.me.user.id}` : ''}`).catch(notifyError)}><DownloadIcon />{t('deliveries.export_csv')}</Button>
    <Button variant="outline" onclick={() => download(`/deliveries/route?date=${date}&format=gpx`).catch(notifyError)}><DownloadIcon />{t('deliveries.export_gpx')}</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 flex flex-wrap items-end gap-4">
  <Field.Field class="w-auto">
    <Field.Label for="dl-date">{t('deliveries.day')}</Field.Label>
    <Input id="dl-date" type="date" class="w-44" bind:value={date} onchange={() => load().catch(notifyError)} />
  </Field.Field>
  <Field.Field orientation="horizontal" class="w-auto pb-2">
    <Switch id="dl-mine" bind:checked={mine} onCheckedChange={() => load().catch(notifyError)} />
    <Field.Label for="dl-mine" class="font-normal">{t('deliveries.my_run')}</Field.Label>
  </Field.Field>
</div>

{#if !list}
  <Spinner />
{:else if !list.length}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Media variant="icon"><TruckIcon /></Empty.Media>
      <Empty.Title>{t('deliveries.empty')}</Empty.Title>
      <Empty.Description>{t('deliveries.empty_hint')}</Empty.Description>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ol class="flex flex-col gap-3" data-testid="delivery-run">
    {#each list as d, i (d.id)}
      <li>
        <Card.Root size="sm" data-testid="delivery-stop">
          <Card.Header>
            <Card.Title class="flex flex-wrap items-center gap-2">
              <span class="text-muted-foreground tabular-nums">{i + 1}.</span>
              <Badge variant={d.kind === 'delivery' ? 'default' : 'secondary'}>{t(`deliveries.kind.${d.kind}` as any)}</Badge>
              <a class="hover:underline" href={to(`/orders/${d.order_id}`)}>#{d.order_number}</a>
              <span>{d.contact?.name || d.customer_name}</span>
            </Card.Title>
            <Card.Description>{time(d.window_start)} – {time(d.window_end)}</Card.Description>
            <Card.Action><StatusBadge status={d.status} label={t(`deliveries.status.${d.status}` as any)} /></Card.Action>
          </Card.Header>
          <Card.Content class="flex flex-col gap-2 text-sm">
            {#if addressText(d.address)}<a class="flex w-fit items-center gap-1.5 hover:underline" href={mapUrl(d)} target="_blank" rel="noopener"><MapPinIcon class="size-4" />{addressText(d.address)}</a>{/if}
            {#if d.contact?.phone}<a class="flex w-fit items-center gap-1.5 hover:underline" href={`tel:${d.contact.phone}`}><PhoneIcon class="size-4" />{d.contact.phone}</a>{/if}
            {#if d.notes}<p class="text-muted-foreground">{d.notes}</p>{/if}
            {#if d.failure_reason}<p class="text-destructive">{t('deliveries.failed_because', { reason: d.failure_reason })}</p>{/if}
            {#if canEdit && drivers.length && ['scheduled', 'dispatched'].includes(d.status)}
              <Field.Field orientation="horizontal" class="w-auto">
                <Field.Label for={`dl-driver-${d.id}`} class="font-normal">{t('deliveries.driver')}</Field.Label>
                <NativeSelect id={`dl-driver-${d.id}`} size="sm" value={d.driver_user_id ?? ''} onchange={(e) => run(() => api.patch(`/deliveries/${d.id}`, { driver_user_id: (e.currentTarget as HTMLSelectElement).value || null }), t('deliveries.driver_saved'))}>
                  <NativeSelectOption value="">{t('deliveries.no_driver')}</NativeSelectOption>
                  {#each drivers as u (u.id)}<NativeSelectOption value={u.id}>{u.name}</NativeSelectOption>{/each}
                </NativeSelect>
              </Field.Field>
            {:else if d.driver_name}
              <p class="text-muted-foreground">{t('deliveries.driver_is', { name: d.driver_name })}</p>
            {/if}
          </Card.Content>
          {#if canEdit}
            <Card.Footer class="flex flex-wrap gap-2">
              {#if d.status === 'scheduled'}<Button size="sm" disabled={busy} onclick={() => run(() => api.post(`/deliveries/${d.id}/actions/dispatch`), t('deliveries.dispatched'))}>{t('deliveries.dispatch')}</Button>{/if}
              {#if ['scheduled', 'dispatched'].includes(d.status)}
                <Button size="sm" variant="outline" onclick={() => ((completing = d), (signedName = d.contact?.name ?? ''))}>{t('deliveries.complete')}</Button>
                <Button size="sm" variant="outline" onclick={() => ((failing = d), (reason = ''), (errors = {}))}>{t('deliveries.fail')}</Button>
              {/if}
              <span class="ml-auto flex gap-1">
                <Button variant="ghost" size="icon-sm" disabled={i === 0 || busy} aria-label={t('deliveries.move_up', { n: i + 1 })} onclick={() => move(i, -1)}><ArrowUpIcon /></Button>
                <Button variant="ghost" size="icon-sm" disabled={i === list.length - 1 || busy} aria-label={t('deliveries.move_down', { n: i + 1 })} onclick={() => move(i, 1)}><ArrowDownIcon /></Button>
              </span>
            </Card.Footer>
          {/if}
        </Card.Root>
      </li>
    {/each}
  </ol>
{/if}

<Dialog.Root open={!!completing} onOpenChange={(v) => !v && (completing = null)}>
  <Dialog.Content>
    {#if completing}
      <form class="flex flex-col gap-4" onsubmit={complete}>
        <Dialog.Header>
          <Dialog.Title>{t(completing.kind === 'delivery' ? 'deliveries.complete_delivery' : 'deliveries.complete_collection', { number: completing.order_number })}</Dialog.Title>
          <Dialog.Description>{t(completing.kind === 'delivery' ? 'deliveries.complete_delivery_hint' : 'deliveries.complete_collection_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Field>
          <Field.Label for="dl-signed">{t('deliveries.signed_name')}</Field.Label>
          <Input id="dl-signed" bind:value={signedName} />
        </Field.Field>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (completing = null)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('deliveries.complete')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!failing} onOpenChange={(v) => !v && (failing = null)}>
  <Dialog.Content>
    {#if failing}
      <form class="flex flex-col gap-4" onsubmit={fail} novalidate>
        <Dialog.Header>
          <Dialog.Title>{t('deliveries.fail_title', { number: failing.order_number })}</Dialog.Title>
          <Dialog.Description>{t('deliveries.fail_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Field data-invalid={!!errors.reason || undefined}>
          <Field.Label for="dl-reason">{t('deliveries.reason')}</Field.Label>
          <Input id="dl-reason" bind:value={reason} aria-invalid={!!errors.reason} />
          {#if errors.reason}<Field.Error>{errors.reason}</Field.Error>{/if}
        </Field.Field>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (failing = null)}>{t('common.cancel')}</Button>
          <Button type="submit" variant="destructive" disabled={busy}>{#if busy}<Spinner />{/if}{t('deliveries.fail')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
