<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Table from '@openrent/ui/table';
  import * as Tabs from '@openrent/ui/tabs';
  import * as Sheet from '@openrent/ui/sheet';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as Empty from '@openrent/ui/empty';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import LanguageTabs from './language-tabs.svelte';
  import { shopLocales } from './shop-locales.svelte.ts';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, getLocale } from '#lib';

  /** Settings → Custom fields (FR-CAT-1): extra fields on products, units, customers and orders. */
  const ENTITIES = ['product', 'stock_item', 'customer', 'order'] as const;
  const TYPES = ['text', 'textarea', 'number', 'boolean', 'date', 'select', 'multiselect', 'url'] as const;
  let entity = $state<(typeof ENTITIES)[number]>('product');
  let defs = $state<any[]>([]);
  let open = $state(false);
  let form = $state<any>(null);
  let errors = $state<Record<string, string>>({});
  // Labels are read by staff (admin language) and customers (shop languages).
  const langs = $derived([...new Set([...shopLocales.list, getLocale()])]);

  async function load() {
    defs = (await api.get(`/custom_field_definitions?filter[entity]=${entity}&limit=200`)).data;
  }
  onMount(() => {
    shopLocales.load().catch(notifyError);
  });
  $effect(() => {
    void entity;
    load().catch(notifyError);
  });

  const label = (labels: Record<string, string>, fallback: string) => labels?.[getLocale()] || labels?.en || Object.values(labels ?? {})[0] || fallback;

  function edit(d: any | null) {
    errors = {};
    form = d
      ? { ...d, labels: { ...d.labels }, help: { ...d.help }, options: d.options.map((o: any) => ({ value: o.value, labels: { ...o.labels } })) }
      : { id: null, entity, key: '', type: 'text', required: false, visibility: 'internal', labels: {}, help: {}, options: [] };
    open = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    const body: Record<string, unknown> = {
      type: form.type, required: form.required, visibility: form.visibility, labels: form.labels, help: form.help,
      options: form.type === 'select' || form.type === 'multiselect' ? form.options : [],
    };
    try {
      if (form.id) await api.patch(`/custom_field_definitions/${form.id}`, body);
      else await api.post('/custom_field_definitions', { ...body, entity: form.entity, key: form.key, position: defs.length });
      open = false;
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    }
  }

  async function remove(d: any) {
    if (!(await confirmAction({ title: t('customfields.remove_title', { name: label(d.labels, d.key) }), description: t('customfields.remove_description'), confirmLabel: t('common.remove'), destructive: true }))) return;
    try {
      await api.del(`/custom_field_definitions/${d.id}`);
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  async function move(i: number, dir: -1 | 1) {
    const list = [...defs];
    [list[i], list[i + dir]] = [list[i + dir]!, list[i]!];
    try {
      await Promise.all(list.map((d, p) => (d.position === p ? null : api.patch(`/custom_field_definitions/${d.id}`, { position: p }))));
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  // Keys are written from the English label until edited by hand.
  let keyEdited = $state(false);
  const keyFrom = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{t('customfields.title')}</Card.Title>
    <Card.Description>{t('customfields.hint')}</Card.Description>
    <Card.Action><Button size="sm" onclick={() => { keyEdited = false; edit(null); }}><PlusIcon />{t('customfields.new')}</Button></Card.Action>
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <Tabs.Root bind:value={entity}>
      <Tabs.List>{#each ENTITIES as e (e)}<Tabs.Trigger value={e}>{t(`customfields.entity.${e}` as any)}</Tabs.Trigger>{/each}</Tabs.List>
    </Tabs.Root>
    {#if defs.length}
      <Table.Root>
        <Table.Header>
          <Table.Row><Table.Head>{t('customfields.label')}</Table.Head><Table.Head>{t('customfields.type')}</Table.Head><Table.Head>{t('customfields.visibility')}</Table.Head><Table.Head class="w-40"></Table.Head></Table.Row>
        </Table.Header>
        <Table.Body>
          {#each defs as d, i (d.id)}
            <Table.Row data-testid="custom-field-row">
              <Table.Cell>
                <div class="font-medium">{label(d.labels, d.key)}{#if d.required}<Badge variant="secondary" class="ml-2">{t('customfields.required_badge')}</Badge>{/if}</div>
                <div class="text-muted-foreground font-mono text-xs">{d.key}</div>
              </Table.Cell>
              <Table.Cell>{t(`customfields.type.${d.type}` as any)}</Table.Cell>
              <Table.Cell>{t(`customfields.visibility.${d.visibility}` as any)}</Table.Cell>
              <Table.Cell class="text-right whitespace-nowrap">
                <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={t('sections.move_up', { name: label(d.labels, d.key) })} onclick={() => move(i, -1)}><ArrowUpIcon /></Button>
                <Button variant="ghost" size="icon-sm" disabled={i === defs.length - 1} aria-label={t('sections.move_down', { name: label(d.labels, d.key) })} onclick={() => move(i, 1)}><ArrowDownIcon /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('customfields.edit', { name: label(d.labels, d.key) })} onclick={() => edit(d)}><PencilIcon /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('customfields.remove_title', { name: label(d.labels, d.key) })} onclick={() => remove(d)}><TrashIcon /></Button>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      <Empty.Root class="p-6"><Empty.Description>{t('customfields.empty')}</Empty.Description></Empty.Root>
    {/if}
  </Card.Content>
</Card.Root>

<Sheet.Root bind:open>
  <Sheet.Content class="overflow-y-auto sm:max-w-lg">
    {#if form}
      <form class="flex flex-col gap-4 p-4" onsubmit={save}>
        <Sheet.Header class="p-0"><Sheet.Title>{form.id ? t('customfields.edit', { name: label(form.labels, form.key) }) : t('customfields.new')}</Sheet.Title></Sheet.Header>
        <Field.Group>
          <LanguageTabs locales={langs}>
            {#snippet children(l: string)}
              <Field.Group class="gap-3">
                <Field.Field data-invalid={!!errors[`labels.${l}`] || undefined}>
                  <Field.Label for={`cf-label-${l}`}>{t('customfields.label')}</Field.Label>
                  <Input
                    id={`cf-label-${l}`}
                    lang={l}
                    maxlength={200}
                    value={form.labels[l] ?? ''}
                    oninput={(e) => {
                      form.labels[l] = (e.currentTarget as HTMLInputElement).value;
                      if (!form.id && !keyEdited && (l === 'en' || !form.labels.en)) form.key = keyFrom(form.labels[l]);
                    }}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label for={`cf-help-${l}`}>{t('customfields.help')}</Field.Label>
                  <Input id={`cf-help-${l}`} lang={l} maxlength={200} bind:value={form.help[l]} />
                </Field.Field>
                {#if form.type === 'select' || form.type === 'multiselect'}
                  <Field.Field data-invalid={!!errors.options || undefined}>
                    <Field.Label>{t('customfields.options')}</Field.Label>
                    {#each form.options as o, i (i)}
                      <div class="flex gap-2">
                        <Input class="w-32 font-mono" aria-label={t('customfields.option_value')} bind:value={o.value} disabled={!!form.id && !!defs.find((d) => d.id === form.id)?.options.some((x: any) => x.value === o.value)} />
                        <Input lang={l} aria-label={t('customfields.option_label')} value={o.labels[l] ?? ''} oninput={(e) => (o.labels[l] = (e.currentTarget as HTMLInputElement).value)} />
                        <Button type="button" variant="ghost" size="icon" aria-label={t('common.remove')} onclick={() => (form.options = form.options.filter((_: unknown, j: number) => j !== i))}><TrashIcon /></Button>
                      </div>
                    {/each}
                    <div><Button type="button" size="sm" variant="outline" onclick={() => (form.options = [...form.options, { value: `option_${form.options.length + 1}`, labels: {} }])}><PlusIcon />{t('customfields.add_option')}</Button></div>
                    {#if errors.options}<Field.Error>{errors.options}</Field.Error>{/if}
                  </Field.Field>
                {/if}
              </Field.Group>
            {/snippet}
          </LanguageTabs>
          <Field.Field data-invalid={!!errors.key || undefined}>
            <Field.Label for="cf-key">{t('customfields.key')}</Field.Label>
            <Input id="cf-key" class="font-mono" bind:value={form.key} disabled={!!form.id} oninput={() => (keyEdited = true)} aria-invalid={!!errors.key} />
            {#if errors.key}<Field.Error>{errors.key}</Field.Error>{:else}<Field.Description>{t('customfields.key_hint')}</Field.Description>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="cf-type">{t('customfields.type')}</Field.Label>
            <NativeSelect.Root id="cf-type" class="w-full" bind:value={form.type}>{#each TYPES as x (x)}<NativeSelect.Option value={x}>{t(`customfields.type.${x}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
          </Field.Field>
          <Field.Field>
            <Field.Label for="cf-vis">{t('customfields.visibility')}</Field.Label>
            <NativeSelect.Root id="cf-vis" class="w-full" bind:value={form.visibility}>{#each ['internal', 'storefront', 'portal'] as x (x)}<NativeSelect.Option value={x}>{t(`customfields.visibility.${x}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
            <Field.Description>{t('customfields.visibility_hint')}</Field.Description>
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch id="cf-req" bind:checked={form.required} />
            <Field.Label for="cf-req" class="font-normal">{t('customfields.required')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <Sheet.Footer class="p-0"><Button type="submit">{t('common.save')}</Button></Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
