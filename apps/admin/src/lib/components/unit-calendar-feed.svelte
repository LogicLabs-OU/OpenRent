<script lang="ts">
  import * as Field from '@openrent/ui/field';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Button } from '@openrent/ui/button';
  import CalendarPlusIcon from '@lucide/svelte/icons/calendar-plus';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { api, t, toast, notifyError, rel, confirmAction } from '#lib';

  /** iCal link of one unit's bookings and downtime (FR-INT-2); the URL is shown once, like an API key. */
  let { stockItemId, label }: { stockItemId: string; label: string } = $props();
  let feeds = $state<any[]>([]);
  let url = $state('');

  async function load() {
    feeds = (await api.get(`/calendar_feeds?stock_item_id=${stockItemId}`)).data;
  }
  $effect(() => {
    url = '';
    load().catch(notifyError);
  });

  async function create() {
    try {
      url = (await api.post('/calendar_feeds', { name: t('calendar.unit_feed_name', { unit: label }), stock_item_id: stockItemId })).url;
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  async function revoke(f: any) {
    if (!(await confirmAction({ title: t('calendar.revoke_title', { name: f.name }), description: t('calendar.revoke_description'), confirmLabel: t('settings.revoke'), destructive: true }))) return;
    try {
      await api.del(`/calendar_feeds/${f.id}`);
      toast.success(t('calendar.revoked'));
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    toast.success(t('calendar.copied'));
  }
</script>

<Field.Field data-testid="unit-calendar">
  <Field.Label>{t('calendar.unit_title')}</Field.Label>
  <Field.Description>{t('calendar.unit_hint')}</Field.Description>
  {#if url}
    <InputGroup.Root>
      <InputGroup.Input readonly value={url} aria-label={t('calendar.url')} data-testid="unit-calendar-url" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
      <InputGroup.Addon align="inline-end"><InputGroup.Button onclick={copy}><CopyIcon />{t('calendar.copy')}</InputGroup.Button></InputGroup.Addon>
    </InputGroup.Root>
    <Field.Description>{t('calendar.created_hint')}</Field.Description>
  {/if}
  {#each feeds as f (f.id)}
    <div class="flex items-center justify-between gap-2 text-sm">
      <span>{f.name} · <span class="text-muted-foreground">{f.last_used_at ? rel(f.last_used_at) : t('calendar.never')}</span></span>
      <Button type="button" size="sm" variant="ghost" onclick={() => revoke(f)}>{t('settings.revoke')}</Button>
    </div>
  {/each}
  <div><Button type="button" size="sm" variant="outline" onclick={create}><CalendarPlusIcon />{t('calendar.unit_create')}</Button></div>
</Field.Field>
