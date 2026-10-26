<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Table from '@openrent/ui/table';
  import * as Sheet from '@openrent/ui/sheet';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import ArchiveIcon from '@lucide/svelte/icons/archive';
  import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
  import LocationEditor from './location-editor.svelte';
  import { api, session, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';

  /**
   * Settings → Locations (FR-LOC-1): every shop location, its address, contact and tax details, time zone,
   * opening hours and closed days. Archived locations can be brought back.
   */
  const ADDRESS = ['line1', 'line2', 'postal_code', 'city', 'country'] as const;
  const ZONES = Intl.supportedValuesOf('timeZone');
  let locations = $state<any[]>([]);
  let archived = $state<any[]>([]);
  let taxProfiles = $state<{ id: string; name: string }[]>([]);
  let selected = $state('');
  let open = $state(false);
  let form = $state<any>(null);
  let errors = $state<Record<string, string>>({});

  async function load() {
    const all = (await api.get('/locations?archived=true')).data;
    locations = all.filter((l: any) => !l.deleted_at);
    archived = all.filter((l: any) => l.deleted_at);
    if (!locations.some((l) => l.id === selected)) selected = locations[0]?.id ?? '';
  }
  onMount(() => {
    load().catch(notifyError);
    if (session.can('pricing:read')) api.get('/tax_profiles?limit=100').then((r) => (taxProfiles = r.data), () => undefined);
  });

  function edit(l: any | null) {
    errors = {};
    const blank = Object.fromEntries(ADDRESS.map((k) => [k, '']));
    form = l
      ? { id: l.id, name: l.name, timezone: l.timezone, is_default: l.is_default, address: { ...blank, ...(l.address ?? {}) }, phone: l.phone ?? '', email: l.email ?? '', tax_id: l.tax_ids?.[0]?.value ?? '', tax_profile_id: l.tax_profile_id ?? '' }
      : { id: null, name: '', timezone: session.me?.tenant?.timezone ?? 'UTC', is_default: false, address: blank, phone: '', email: '', tax_id: '', tax_profile_id: '' };
    open = true;
  }

  /** Refreshes the location list everywhere: pickers appear once there is a second location. */
  async function changed(id?: string) {
    await load();
    await session.load();
    if (id) selected = id;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    const body = {
      name: form.name, timezone: form.timezone, is_default: form.is_default, address: Object.fromEntries(Object.entries(form.address).filter(([, v]) => String(v).trim())),
      phone: form.phone, email: form.email, tax_ids: form.tax_id.trim() ? [{ type: 'VAT', value: form.tax_id.trim() }] : [], tax_profile_id: form.tax_profile_id || null,
    };
    try {
      const l = form.id ? await api.patch(`/locations/${form.id}`, body) : await api.post('/locations', body);
      open = false;
      toast.success(form.id ? t('common.saved') : t('locations.created', { name: l.name }));
      await changed(l.id);
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    }
  }

  async function archive(l: any) {
    if (!(await confirmAction({ title: t('locations.archive_title', { name: l.name }), description: t('locations.archive_description'), confirmLabel: t('locations.archive'), destructive: true }))) return;
    try {
      await api.del(`/locations/${l.id}`);
      toast.success(t('locations.archived', { name: l.name }));
      await changed();
    } catch (err) {
      notifyError(err);
    }
  }

  async function restore(l: any) {
    try {
      await api.post(`/locations/${l.id}/actions/restore`, {});
      toast.success(t('locations.restored', { name: l.name }));
      await changed(l.id);
    } catch (err) {
      notifyError(err);
    }
  }

  async function makeDefault(l: any) {
    try {
      await api.patch(`/locations/${l.id}`, { is_default: true });
      toast.success(t('locations.default_set', { name: l.name }));
      await changed(l.id);
    } catch (err) {
      notifyError(err);
    }
  }

  const current = $derived(locations.find((l) => l.id === selected));
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{t('locations.title')}</Card.Title>
    <Card.Description>{t('locations.hint')}</Card.Description>
    <Card.Action><Button size="sm" onclick={() => edit(null)}><PlusIcon />{t('locations.new')}</Button></Card.Action>
  </Card.Header>
  <Card.Content>
    <Table.Root>
      <Table.Header>
        <Table.Row><Table.Head>{t('field.name')}</Table.Head><Table.Head>{t('field.timezone')}</Table.Head><Table.Head class="w-40"></Table.Head></Table.Row>
      </Table.Header>
      <Table.Body>
        {#each locations as l (l.id)}
          <Table.Row data-testid="location-row" data-state={l.id === selected ? 'selected' : undefined} class="cursor-pointer" onclick={() => (selected = l.id)}>
            <Table.Cell class="font-medium">{l.name} {#if l.is_default}<Badge variant="secondary" class="ml-1">{t('locations.default')}</Badge>{/if}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{l.timezone}</Table.Cell>
            <Table.Cell class="text-right">
              {#if !l.is_default}<Button variant="ghost" size="sm" onclick={(e) => { e.stopPropagation(); makeDefault(l); }}>{t('locations.make_default')}</Button>{/if}
              <Button variant="ghost" size="icon-sm" aria-label={t('locations.edit', { name: l.name })} onclick={(e) => { e.stopPropagation(); edit(l); }}><PencilIcon /></Button>
              {#if locations.length > 1}<Button variant="ghost" size="icon-sm" aria-label={t('locations.archive_title', { name: l.name })} onclick={(e) => { e.stopPropagation(); archive(l); }}><ArchiveIcon /></Button>{/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
    {#if archived.length}
      <h3 class="mt-6 mb-2 text-sm font-medium">{t('locations.archived_heading')}</h3>
      <ul class="flex flex-col divide-y rounded-md border text-sm" data-testid="archived-locations">
        {#each archived as l (l.id)}
          <li class="flex items-center justify-between gap-2 px-3 py-2">
            <span class="text-muted-foreground">{l.name}</span>
            <Button variant="ghost" size="sm" onclick={() => restore(l)}><ArchiveRestoreIcon />{t('locations.restore')}</Button>
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>

{#if current}
  {#key current.id}<LocationEditor location={current} />{/key}
{/if}

<Sheet.Root bind:open>
  <Sheet.Content class="overflow-y-auto sm:max-w-md">
    {#if form}
      <form class="flex flex-col gap-4 p-4" onsubmit={save} novalidate>
        <Sheet.Header class="p-0">
          <Sheet.Title>{form.id ? t('locations.edit', { name: form.name }) : t('locations.new')}</Sheet.Title>
        </Sheet.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="loc-name">{t('field.name')}</Field.Label>
            <Input id="loc-name" required maxlength={120} bind:value={form.name} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          {#each ADDRESS as k (k)}
            <Field.Field>
              <Field.Label for={`loc-${k}`}>{t(`customer.address.${k}` as any)}</Field.Label>
              <Input id={`loc-${k}`} bind:value={form.address[k]} />
            </Field.Field>
          {/each}
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field data-invalid={!!errors.phone || undefined}>
              <Field.Label for="loc-phone">{t('field.phone')}</Field.Label>
              <Input id="loc-phone" type="tel" maxlength={50} bind:value={form.phone} aria-invalid={!!errors.phone} />
              {#if errors.phone}<Field.Error>{errors.phone}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.email || undefined}>
              <Field.Label for="loc-email">{t('field.email')}</Field.Label>
              <Input id="loc-email" type="email" maxlength={200} bind:value={form.email} aria-invalid={!!errors.email} />
              {#if errors.email}<Field.Error>{errors.email}</Field.Error>{/if}
            </Field.Field>
          </div>
          <Field.Field data-invalid={!!errors.tax_ids || undefined}>
            <Field.Label for="loc-tax-id">{t('field.tax_id')}</Field.Label>
            <Input id="loc-tax-id" maxlength={50} bind:value={form.tax_id} aria-invalid={!!errors.tax_ids} />
            {#if errors.tax_ids}<Field.Error>{errors.tax_ids}</Field.Error>{:else}<Field.Description>{t('locations.tax_id_hint')}</Field.Description>{/if}
          </Field.Field>
          {#if taxProfiles.length}
            <Field.Field data-invalid={!!errors.tax_profile_id || undefined}>
              <Field.Label for="loc-tax-profile">{t('locations.tax_profile')}</Field.Label>
              <NativeSelect.Root id="loc-tax-profile" class="w-full" bind:value={form.tax_profile_id} aria-invalid={!!errors.tax_profile_id}>
                <NativeSelect.Option value="">{t('locations.tax_profile_shop')}</NativeSelect.Option>
                {#each taxProfiles as tp (tp.id)}<NativeSelect.Option value={tp.id}>{tp.name}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
              {#if errors.tax_profile_id}<Field.Error>{errors.tax_profile_id}</Field.Error>{:else}<Field.Description>{t('locations.tax_profile_hint')}</Field.Description>{/if}
            </Field.Field>
          {/if}
          <Field.Field data-invalid={!!errors.timezone || undefined}>
            <Field.Label for="loc-tz">{t('field.timezone')}</Field.Label>
            <NativeSelect.Root id="loc-tz" class="w-full" bind:value={form.timezone}>{#each ZONES as z (z)}<NativeSelect.Option value={z}>{z}</NativeSelect.Option>{/each}</NativeSelect.Root>
            {#if errors.timezone}<Field.Error>{errors.timezone}</Field.Error>{:else}<Field.Description>{t('locations.timezone_hint')}</Field.Description>{/if}
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch id="loc-default" bind:checked={form.is_default} disabled={form.id && locations.find((l) => l.id === form.id)?.is_default} />
            <Field.Label for="loc-default" class="font-normal">{t('locations.is_default')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <Sheet.Footer class="p-0">
          <Button type="submit">{form.id ? t('common.save') : t('locations.create')}</Button>
        </Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
