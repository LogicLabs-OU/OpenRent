<script lang="ts" module>
  import { api, getLocale } from '#lib';

  export interface PluginPageDef {
    plugin_id: string;
    key: string;
    title: string;
    description: string | null;
    placement: 'settings' | 'customer';
    path: string;
    columns: { key: string; label: string; type: 'text' | 'number' | 'money' | 'date' | 'datetime' | 'badge' }[];
    form: { create: boolean; update: boolean; fields: Field[] } | null;
    remove: boolean;
    actions: { key: string; label: string; confirm: string | null; destructive: boolean; when: { field: string; in: string[] } | null }[];
    empty: string | null;
  }
  type Field = {
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'number' | 'money' | 'select' | 'boolean' | 'date';
    required: boolean;
    help: string | null;
    min: number | null;
    max: number | null;
    step: number | null;
    create_only: boolean;
    options: { value: string; label: string }[];
    options_path: string | null;
  };

  let pages: Promise<PluginPageDef[]> | null = null;
  /** The plugin pages of this shop, loaded once per page load. */
  function allPages() {
    pages ??= api.get(`/plugin_pages?locale=${encodeURIComponent(getLocale())}`).then((r) => r.data as PluginPageDef[], () => []);
    return pages;
  }
</script>

<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Button } from '@openrent/ui/button';
  import { Money, StatusBadge } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import { t, toast, notifyError, fieldErrors, confirmAction, minorFromInput, majorFromMinor, d, dt } from '#lib';

  /**
   * Pages of records plugins keep (plugin API 1.9), drawn with the admin's own components: a table, a form
   * to add or change a record, and actions on each. On a customer's page, `customerId` narrows the list.
   */
  let { placement, customerId = null, onchange }: { placement: 'settings' | 'customer'; customerId?: string | null; onchange?: () => void } = $props();
  let defs = $state<PluginPageDef[]>([]);
  let rows = $state<Record<string, any[]>>({});

  const id = (p: PluginPageDef) => `${p.plugin_id}:${p.key}`;
  const listUrl = (p: PluginPageDef) => (customerId ? `${p.path}?customer_id=${encodeURIComponent(customerId)}` : p.path);
  async function load(p: PluginPageDef) {
    try {
      rows[id(p)] = (await api.get(listUrl(p))).data ?? [];
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    const where = placement;
    allPages().then((all) => {
      defs = all.filter((p) => p.placement === where);
      for (const p of defs) load(p);
    });
  });

  // The form: a new record, or one being changed.
  let editing = $state<{ page: PluginPageDef; record: any | null } | null>(null);
  let values = $state<Record<string, any>>({});
  let errors = $state<Record<string, string>>({});
  const fields = $derived(editing ? (editing.page.form?.fields ?? []).filter((f) => !(editing!.record && f.create_only)) : []);
  // Choices that are the shop's own data come from the plugin when the form opens.
  let choices = $state<Record<string, { value: string; label: string }[]>>({});
  function open(page: PluginPageDef, record: any | null) {
    editing = { page, record };
    errors = {};
    for (const f of page.form?.fields ?? []) {
      if (f.options_path) api.get(`${f.options_path}${customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''}`).then((r) => (choices[f.key] = r.data ?? []), notifyError);
    }
    values = Object.fromEntries(
      (page.form?.fields ?? []).map((f) => {
        const v = record?.[f.key];
        if (f.type === 'money') return [f.key, v == null ? '' : majorFromMinor(typeof v === 'object' ? v.amount : v)];
        if (f.type === 'boolean') return [f.key, !!v];
        return [f.key, v ?? ''];
      }),
    );
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    const { page, record } = editing!;
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === 'money') body[f.key] = String(v).trim() === '' ? null : minorFromInput(v);
      else if (f.type === 'number') body[f.key] = String(v).trim() === '' ? null : Number(v);
      else if (f.type === 'boolean') body[f.key] = !!v;
      else body[f.key] = String(v ?? '').trim() === '' ? null : v;
    }
    if (customerId && !record) body.customer_id = customerId;
    try {
      if (record) await api.patch(`${page.path}/${record.id}`, body);
      else await api.post(page.path, body);
      toast.success(t('common.saved'));
      editing = null;
      await load(page);
      onchange?.();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    }
  }

  async function remove(page: PluginPageDef, record: any) {
    if (!(await confirmAction({ title: t('plugin_page.delete_title'), description: t('plugin_page.delete_description'), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`${page.path}/${record.id}`);
      toast.success(t('common.removed'));
      await load(page);
      onchange?.();
    } catch (e) {
      notifyError(e);
    }
  }

  async function run(page: PluginPageDef, record: any, action: PluginPageDef['actions'][number]) {
    if (action.confirm && !(await confirmAction({ title: action.label, description: action.confirm, confirmLabel: action.label, destructive: action.destructive }))) return;
    try {
      await api.post(`${page.path}/${record.id}/actions/${action.key}`, {});
      toast.success(t('plugin_page.done', { action: action.label }));
      await load(page);
      onchange?.();
    } catch (e) {
      notifyError(e);
    }
  }
  const shown = (page: PluginPageDef, record: any) => page.actions.filter((a) => !a.when || a.when.in.includes(String(record[a.when.field] ?? '')));
  const label = (record: any, page: PluginPageDef) => String(record[page.columns[0]?.key ?? 'id'] ?? record.id);
</script>

{#each defs as page (id(page))}
  <Card.Root data-testid={`plugin-page-${page.plugin_id}-${page.key}`}>
    <Card.Header>
      <Card.Title>{page.title}</Card.Title>
      {#if page.description}<Card.Description>{page.description}</Card.Description>{/if}
      {#if page.form?.create}<Card.Action><Button size="sm" variant="outline" onclick={() => open(page, null)}><PlusIcon />{t('common.add')}</Button></Card.Action>{/if}
    </Card.Header>
    <Card.Content>
      {#if (rows[id(page)] ?? []).length}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              {#each page.columns as c (c.key)}<Table.Head class={c.type === 'money' || c.type === 'number' ? 'text-right' : ''}>{c.label}</Table.Head>{/each}
              <Table.Head><span class="sr-only">{t('plugin_page.actions_column')}</span></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each rows[id(page)] ?? [] as record (record.id)}
              <Table.Row>
                {#each page.columns as c (c.key)}
                  {@const v = record[c.key]}
                  <Table.Cell class={c.type === 'money' || c.type === 'number' ? 'text-right tabular-nums' : ''}>
                    {#if v == null || v === ''}–
                    {:else if c.type === 'money'}<Money value={v} />
                    {:else if c.type === 'date'}{d(v)}
                    {:else if c.type === 'datetime'}{dt(v)}
                    {:else if c.type === 'badge'}<StatusBadge status={String(v)} label={String(record[`${c.key}_label`] ?? v)} />
                    {:else if c.type === 'number'}{new Intl.NumberFormat(getLocale()).format(Number(v))}
                    {:else}{v}{/if}
                  </Table.Cell>
                {/each}
                <Table.Cell class="text-right">
                  {#if page.form?.update || page.remove || shown(page, record).length}
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        {#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={t('plugin_page.actions', { name: label(record, page) })}><EllipsisIcon /></Button>{/snippet}
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="end">
                        {#if page.form?.update}<DropdownMenu.Item onclick={() => open(page, record)}>{t('common.edit')}</DropdownMenu.Item>{/if}
                        {#each shown(page, record) as a (a.key)}<DropdownMenu.Item onclick={() => run(page, record, a)}>{a.label}</DropdownMenu.Item>{/each}
                        {#if page.remove}<DropdownMenu.Item variant="destructive" onclick={() => remove(page, record)}>{t('common.delete')}</DropdownMenu.Item>{/if}
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {:else}
        <p class="text-muted-foreground text-sm">{page.empty ?? t('plugin_page.empty')}</p>
      {/if}
    </Card.Content>
  </Card.Root>
{/each}

<Dialog.Root open={!!editing} onOpenChange={(o) => !o && (editing = null)}>
  <Dialog.Content>
    {#if editing}
      <form class="flex flex-col gap-4" onsubmit={save} novalidate>
        <Dialog.Header><Dialog.Title>{editing.page.title}</Dialog.Title></Dialog.Header>
        <Field.Group>
          {#each fields as f (f.key)}
            {@const fid = `pp-${editing.page.key}-${f.key}`}
            <Field.Field data-invalid={!!errors[f.key] || undefined} orientation={f.type === 'boolean' ? 'horizontal' : 'vertical'}>
              {#if f.type === 'boolean'}
                <Checkbox id={fid} bind:checked={values[f.key]} />
                <Field.Label for={fid}>{f.label}</Field.Label>
              {:else}
                <Field.Label for={fid}>{f.label}</Field.Label>
                {#if f.type === 'textarea'}
                  <Textarea id={fid} bind:value={values[f.key]} aria-invalid={!!errors[f.key]} />
                {:else if f.type === 'select'}
                  <NativeSelect id={fid} bind:value={values[f.key]} aria-invalid={!!errors[f.key]}>
                    {#if !f.required}<NativeSelectOption value="">–</NativeSelectOption>{/if}
                    {#each f.options_path ? (choices[f.key] ?? []) : f.options as o (o.value)}<NativeSelectOption value={o.value}>{o.label}</NativeSelectOption>{/each}
                  </NativeSelect>
                {:else}
                  <Input
                    id={fid}
                    type={f.type === 'money' || f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    min={f.min ?? (f.type === 'money' ? 0 : undefined)}
                    max={f.max ?? undefined}
                    step={f.step ?? (f.type === 'money' ? 0.01 : undefined)}
                    required={f.required}
                    bind:value={values[f.key]}
                    aria-invalid={!!errors[f.key]}
                  />
                {/if}
              {/if}
              {#if f.help}<Field.Description>{f.help}</Field.Description>{/if}
              {#if errors[f.key]}<Field.Error>{errors[f.key]}</Field.Error>{/if}
            </Field.Field>
          {/each}
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (editing = null)}>{t('common.cancel')}</Button>
          <Button type="submit">{t('common.save')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
