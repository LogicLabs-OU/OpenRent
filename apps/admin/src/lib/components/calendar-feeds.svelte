<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import * as Dialog from '@openrent/ui/dialog';
  import * as InputGroup from '@openrent/ui/input-group';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import CalendarIcon from '@lucide/svelte/icons/calendar';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import { api, session, t, toast, notifyError, fieldErrors, rel, confirmAction } from '#lib';

  /** Secret iCal URLs that show pickups and returns in Google, Apple or Outlook calendars (FR-INT-2). */
  let feeds = $state<any[]>([]);
  let open = $state(false);
  let form = $state({ name: '', location_id: '' });
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let created = $state<{ name: string; url: string } | null>(null);

  async function load() {
    try {
      feeds = (await api.get('/calendar_feeds')).data;
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      const f = await api.post('/calendar_feeds', { name: form.name, location_id: form.location_id || null });
      created = { name: f.name, url: f.url };
      form = { name: '', location_id: '' };
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function revoke(f: any) {
    if (
      !(await confirmAction({
        title: t('calendar.revoke_title', { name: f.name }),
        description: t('calendar.revoke_description'),
        confirmLabel: t('settings.revoke'),
        destructive: true,
      }))
    )
      return;
    try {
      await api.del(`/calendar_feeds/${f.id}`);
      toast.success(t('calendar.revoked'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    toast.success(t('calendar.copied'));
  }
</script>

<Card.Root data-testid="calendar-feeds">
  <Card.Header>
    <Card.Title>{t('settings.tab.calendar')}</Card.Title>
    <Card.Description>{t('calendar.description')}</Card.Description>
    <Card.Action>
      <Button
        onclick={() => {
          created = null;
          errors = {};
          open = true;
        }}><PlusIcon />{t('calendar.new')}</Button
      >
    </Card.Action>
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <Alert.Root>
      <ShieldAlertIcon />
      <Alert.Title>{t('calendar.secret_title')}</Alert.Title>
      <Alert.Description>{t('calendar.secret_hint')}</Alert.Description>
    </Alert.Root>
    {#if feeds.length}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{t('field.name')}</Table.Head>
            <Table.Head>{t('field.location')}</Table.Head>
            <Table.Head>{t('calendar.last_used')}</Table.Head>
            <Table.Head class="w-24"><span class="sr-only">{t('settings.revoke')}</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each feeds as f (f.id)}
            <Table.Row>
              <Table.Cell class="font-medium">{f.name}</Table.Cell>
              <Table.Cell>{f.stock_item_id ? t('calendar.unit_label', { unit: f.stock_item_label ?? '' }) : (f.location_name ?? t('calendar.all_locations'))}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-sm"
                >{f.last_used_at ? rel(f.last_used_at) : t('calendar.never')}</Table.Cell
              >
              <Table.Cell class="text-right"
                ><Button size="sm" variant="ghost" onclick={() => revoke(f)}>{t('settings.revoke')}</Button
                ></Table.Cell
              >
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      <p class="text-muted-foreground flex items-center gap-2 text-sm">
        <CalendarIcon class="size-4" />{t('calendar.none')}
      </p>
    {/if}
  </Card.Content>
</Card.Root>

<Dialog.Root bind:open>
  <Dialog.Content>
    {#if created}
      <Dialog.Header>
        <Dialog.Title>{t('calendar.created_title', { name: created.name })}</Dialog.Title>
        <Dialog.Description>{t('calendar.created_hint')}</Dialog.Description>
      </Dialog.Header>
      <InputGroup.Root>
        <InputGroup.Input
          readonly
          value={created.url}
          aria-label={t('calendar.url')}
          data-testid="calendar-url"
          onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        />
        <InputGroup.Addon align="inline-end"
          ><InputGroup.Button onclick={() => copy(created!.url)}
            ><CopyIcon />{t('calendar.copy')}</InputGroup.Button
          ></InputGroup.Addon
        >
      </InputGroup.Root>
      <Dialog.Footer><Button onclick={() => (open = false)}>{t('calendar.done')}</Button></Dialog.Footer>
    {:else}
      <form class="flex flex-col gap-4" onsubmit={create}>
        <Dialog.Header>
          <Dialog.Title>{t('calendar.new')}</Dialog.Title>
          <Dialog.Description>{t('calendar.new_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="cf-name">{t('field.name')}</Field.Label>
            <Input
              id="cf-name"
              placeholder={t('calendar.name_placeholder')}
              bind:value={form.name}
              aria-invalid={!!errors.name}
            />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          {#if session.locations.length > 1}
            <Field.Field data-invalid={!!errors.location_id || undefined}>
              <Field.Label for="cf-loc">{t('field.location')}</Field.Label>
              <NativeSelect.Root id="cf-loc" class="w-full" bind:value={form.location_id}>
                <NativeSelect.Option value="">{t('calendar.all_locations')}</NativeSelect.Option>
                {#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}
                    >{l.name}</NativeSelect.Option
                  >{/each}
              </NativeSelect.Root>
              {#if errors.location_id}<Field.Error>{errors.location_id}</Field.Error>{/if}
            </Field.Field>
          {/if}
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy}
            >{#if busy}<Spinner />{/if}{t('common.create')}</Button
          >
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
