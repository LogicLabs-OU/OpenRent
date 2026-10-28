<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as Dialog from '@openrent/ui/dialog';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import RadioIcon from '@lucide/svelte/icons/radio';
  import { api, t, toast, notifyError, fieldErrors, rel, confirmAction, session, getLocale } from '#lib';

  /** RFID readers (FR-SCAN-7): each gets an address and a token its bridge posts reads with. */
  let readers = $state<any[]>([]);
  let formats = $state<{ id: string; name: Record<string, string> }[]>([]);
  let open = $state(false);
  let form = $state({ name: '', location_id: '', format: 'openrent' });
  let errors = $state<Record<string, string>>({});
  let created = $state<any>(null);

  async function load() {
    try {
      [readers, formats] = await Promise.all([api.get('/rfid/readers').then((r) => r.data), api.get('/rfid/formats').then((r) => r.data)]);
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);
  const label = (f: { name: Record<string, string> }) => f.name[getLocale()] ?? f.name.en;

  async function create(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    try {
      created = await api.post('/rfid/readers', { name: form.name, location_id: form.location_id || null, format: form.format });
      form = { name: '', location_id: '', format: 'openrent' };
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    }
  }

  async function revoke(r: any) {
    if (!(await confirmAction({ title: t('rfid.revoke_title', { name: r.name }), description: t('rfid.revoke_description'), confirmLabel: t('settings.revoke'), destructive: true }))) return;
    try {
      await api.del(`/rfid/readers/${r.id}`);
      toast.success(t('rfid.revoked'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function copy(v: string) {
    await navigator.clipboard.writeText(v).catch(() => undefined);
    toast.success(t('common.copied'));
  }
</script>

<Card.Root data-testid="rfid-readers">
  <Card.Header>
    <Card.Title>{t('settings.tab.rfid')}</Card.Title>
    <Card.Description>{t('rfid.readers_description')}</Card.Description>
    <Card.Action><Button onclick={() => { created = null; errors = {}; open = true; }}><PlusIcon />{t('rfid.new_reader')}</Button></Card.Action>
  </Card.Header>
  <Card.Content>
    {#if readers.length}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{t('field.name')}</Table.Head>
            <Table.Head>{t('rfid.format')}</Table.Head>
            <Table.Head>{t('rfid.last_read')}</Table.Head>
            <Table.Head class="w-24"><span class="sr-only">{t('settings.revoke')}</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each readers as r (r.id)}
            <Table.Row data-testid="rfid-reader">
              <Table.Cell class="font-medium">{r.name}</Table.Cell>
              <Table.Cell>{label(formats.find((f) => f.id === r.format) ?? { name: { en: r.format } })}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-sm">{r.last_read_at ? rel(r.last_read_at) : t('calendar.never')}</Table.Cell>
              <Table.Cell class="text-right"><Button size="sm" variant="ghost" onclick={() => revoke(r)}>{t('settings.revoke')}</Button></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      <p class="text-muted-foreground flex items-center gap-2 text-sm"><RadioIcon class="size-4" />{t('rfid.no_readers')}</p>
    {/if}
  </Card.Content>
</Card.Root>

<Dialog.Root bind:open>
  <Dialog.Content>
    {#if created}
      <Dialog.Header>
        <Dialog.Title>{t('rfid.created_title', { name: created.name })}</Dialog.Title>
        <Dialog.Description>{t('rfid.created_hint')}</Dialog.Description>
      </Dialog.Header>
      <Field.Group>
        {#each [['url', t('rfid.address'), created.url], ['token', t('rfid.token'), created.token]] as [key, l, value] (key)}
          <Field.Field>
            <Field.Label for={`rfid-${key}`}>{l}</Field.Label>
            <InputGroup.Root>
              <InputGroup.Input id={`rfid-${key}`} readonly {value} class="font-mono" data-testid={`rfid-${key}`} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
              <InputGroup.Addon align="inline-end"><InputGroup.Button aria-label={t('bi.copy', { what: l })} onclick={() => copy(value)}><CopyIcon /></InputGroup.Button></InputGroup.Addon>
            </InputGroup.Root>
          </Field.Field>
        {/each}
      </Field.Group>
      <Dialog.Footer><Button onclick={() => (open = false)}>{t('common.done')}</Button></Dialog.Footer>
    {:else}
      <form class="flex flex-col gap-4" onsubmit={create}>
        <Dialog.Header>
          <Dialog.Title>{t('rfid.new_reader')}</Dialog.Title>
          <Dialog.Description>{t('rfid.new_reader_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="rr-name">{t('field.name')}</Field.Label>
            <Input id="rr-name" placeholder={t('rfid.reader_placeholder')} bind:value={form.name} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!errors.format || undefined}>
            <Field.Label for="rr-format">{t('rfid.format')}</Field.Label>
            <NativeSelect id="rr-format" class="w-full" bind:value={form.format}>
              {#each formats as f (f.id)}<NativeSelectOption value={f.id}>{label(f)}</NativeSelectOption>{/each}
            </NativeSelect>
            {#if errors.format}<Field.Error>{errors.format}</Field.Error>{/if}
          </Field.Field>
          {#if session.locations.length > 1}
            <Field.Field data-invalid={!!errors.location_id || undefined}>
              <Field.Label for="rr-loc">{t('field.location')}</Field.Label>
              <NativeSelect id="rr-loc" class="w-full" bind:value={form.location_id}>
                <NativeSelectOption value="">{t('calendar.all_locations')}</NativeSelectOption>
                {#each session.locations as l (l.id)}<NativeSelectOption value={l.id}>{l.name}</NativeSelectOption>{/each}
              </NativeSelect>
              {#if errors.location_id}<Field.Error>{errors.location_id}</Field.Error>{/if}
            </Field.Field>
          {/if}
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
          <Button type="submit">{t('common.create')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
