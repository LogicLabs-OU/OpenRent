<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Table from '@openrent/ui/table';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { api, t, toast, notifyError, dt, fromLocalInput } from '#lib';

  /** Opening hours and closed days of one location. */
  let { location }: { location: { id: string; name: string; timezone: string; opening_hours?: Record<string, string[][]> } } = $props();

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const hoursOf = (l: typeof location) => Object.fromEntries(DAYS.map((d) => [d, { open: !!l.opening_hours?.[d]?.length, from: l.opening_hours?.[d]?.[0]?.[0] ?? '09:00', to: l.opening_hours?.[d]?.[0]?.[1] ?? '18:00' }]));
  let hours = $state<Record<string, { open: boolean; from: string; to: string }>>({});
  let blackouts = $state<any[]>([]);
  let newBlackout = $state({ starts: '', ends: '', reason: '' });

  async function loadBlackouts() {
    blackouts = (await api.get(`/locations/${location.id}/blackouts`)).data;
  }
  $effect(() => {
    hours = hoursOf(location);
    loadBlackouts().catch(notifyError);
  });

  async function run(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      await loadBlackouts();
      return true;
    } catch (e) {
      notifyError(e);
      return false;
    }
  }
  const saveHours = () =>
    run(() => api.patch(`/locations/${location.id}`, { opening_hours: Object.fromEntries(Object.entries(hours).filter(([, h]) => h.open).map(([d, h]) => [d, [[h.from, h.to]]])) }), t('common.saved'));
  async function addBlackout() {
    const body = { starts_at: fromLocalInput(newBlackout.starts, location.timezone), ends_at: fromLocalInput(newBlackout.ends, location.timezone), reason: newBlackout.reason };
    if (await run(() => api.post(`/locations/${location.id}/blackouts`, body), t('settings.blackout_added'))) newBlackout = { starts: '', ends: '', reason: '' };
  }
</script>

<Card.Root>
  <Card.Header><Card.Title>{t('settings.hours_title', { name: location.name })}</Card.Title><Card.Description>{t('settings.hours_hint', { tz: location.timezone })}</Card.Description></Card.Header>
  <Card.Content>
    <Field.Group class="gap-3">
      {#each DAYS as day (day)}
        {#if hours[day]}
          <Field.Field orientation="horizontal">
            <Switch id={`d-${location.id}-${day}`} bind:checked={hours[day]!.open} />
            <Field.Label for={`d-${location.id}-${day}`} class="w-28">{t(`weekday.${day}` as any)}</Field.Label>
            <Input type="time" class="w-32" bind:value={hours[day]!.from} disabled={!hours[day]!.open} aria-label={t('settings.opens', { day: t(`weekday.${day}` as any) })} />
            <span class="text-muted-foreground">–</span>
            <Input type="time" class="w-32" bind:value={hours[day]!.to} disabled={!hours[day]!.open} aria-label={t('settings.closes', { day: t(`weekday.${day}` as any) })} />
          </Field.Field>
        {/if}
      {/each}
    </Field.Group>
  </Card.Content>
  <Card.Footer><Button onclick={saveHours}>{t('common.save')}</Button></Card.Footer>
</Card.Root>
<Card.Root>
  <Card.Header><Card.Title>{t('settings.blackouts')}</Card.Title><Card.Description>{t('settings.blackouts_hint')}</Card.Description></Card.Header>
  <Card.Content class="flex flex-col gap-4">
    {#if blackouts.length}
      <Table.Root>
        <Table.Body>
          {#each blackouts as b (b.id)}
            <Table.Row>
              <Table.Cell>{dt(b.starts_at, location.timezone)} – {dt(b.ends_at, location.timezone)}</Table.Cell>
              <Table.Cell class="text-muted-foreground">{b.reason ?? ''}</Table.Cell>
              <Table.Cell class="text-right"><Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onclick={() => run(() => api.del(`/blackouts/${b.id}`), t('common.removed'))}><TrashIcon /></Button></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}<p class="text-muted-foreground text-sm">{t('settings.blackouts_none')}</p>{/if}
    <Field.Group class="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <Field.Field><Field.Label for={`bs-${location.id}`}>{t('inventory.from')}</Field.Label><Input id={`bs-${location.id}`} type="datetime-local" bind:value={newBlackout.starts} /></Field.Field>
      <Field.Field><Field.Label for={`be-${location.id}`}>{t('inventory.until')}</Field.Label><Input id={`be-${location.id}`} type="datetime-local" bind:value={newBlackout.ends} /></Field.Field>
      <Field.Field><Field.Label for={`br-${location.id}`}>{t('cancel.reason')}</Field.Label><Input id={`br-${location.id}`} bind:value={newBlackout.reason} /></Field.Field>
      <Button variant="outline" disabled={!newBlackout.starts || !newBlackout.ends} onclick={addBlackout}><PlusIcon />{t('common.add')}</Button>
    </Field.Group>
  </Card.Content>
</Card.Root>
