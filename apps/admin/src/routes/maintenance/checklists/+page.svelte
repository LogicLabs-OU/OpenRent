<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import XIcon from '@lucide/svelte/icons/x';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, session, getLocale } from '#lib';
  import { to } from '#lib/nav.ts';
  import { shopLocales } from '#lib/components/shop-locales.svelte.ts';

  /**
   * Inspection checklists (FR-MNT-3): what to check on the units of some categories, with each item
   * written in every shop language. Staff run them from the order's inspect step and the scan page.
   */
  type Item = { key?: string; label: Record<string, string>; kind: 'check' | 'number' | 'text'; required: boolean; min: string; max: string; fail_status: string };
  let templates = $state<any[] | null>(null);
  let categories = $state<{ id: string; name: string }[]>([]);
  let form = $state<{ id: string | null; name: string; category_ids: string[]; active: boolean; items: Item[] } | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let onReturn = $state<boolean | null>(null);
  const canEdit = $derived(session.can('inventory:write'));
  const languageName = (code: string) => new Intl.DisplayNames([getLocale()], { type: 'language' }).of(code) ?? code;

  async function load() {
    templates = (await api.get('/inspection_templates')).data;
  }
  onMount(() => {
    load().catch(notifyError);
    shopLocales.load().catch(notifyError);
    api.get('/categories?limit=200').then((r) => (categories = r.data.map((c: any) => ({ id: c.id, name: c.name }))), notifyError);
    if (session.can('tenant:read')) api.get('/tenant/settings').then((s) => (onReturn = !!s.require_inspection_on_return), () => undefined);
  });

  /** A number input bound in Svelte reports an empty field as null. */
  const blank = (v: unknown) => v === '' || v == null;
  const blankItem = (): Item => ({ label: {}, kind: 'check', required: true, min: '', max: '', fail_status: 'soft_down' });
  function edit(tpl: any | null) {
    errors = {};
    form = tpl
      ? {
          id: tpl.id, name: tpl.name, category_ids: [...tpl.category_ids], active: tpl.active,
          items: tpl.items.map((i: any) => ({ key: i.key, label: { ...i.label }, kind: i.kind, required: i.required, min: i.min ?? '', max: i.max ?? '', fail_status: i.fail_status })),
        }
      : { id: null, name: '', category_ids: [], active: true, items: [blankItem()] };
  }
  function move(i: number) {
    if (!form || i === 0) return;
    const items = [...form.items];
    [items[i - 1], items[i]] = [items[i]!, items[i - 1]!];
    form.items = items;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    busy = true;
    errors = {};
    const f = form;
    const body = {
      name: f.name, category_ids: f.category_ids, active: f.active,
      items: f.items.map((i) => ({
        key: i.key, label: i.label, kind: i.kind, required: i.required, fail_status: i.fail_status,
        ...(i.kind === 'number' ? { min: blank(i.min) ? null : Number(i.min), max: blank(i.max) ? null : Number(i.max) } : {}),
      })),
    };
    try {
      await (f.id ? api.patch(`/inspection_templates/${f.id}`, body) : api.post('/inspection_templates', body));
      toast.success(t('common.saved'));
      form = null;
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function archive() {
    if (!form?.id || !(await confirmAction({ title: t('checklists.archive_title', { name: form.name }), description: t('checklists.archive_description'), confirmLabel: t('checklists.archive'), destructive: true }))) return;
    try {
      await api.del(`/inspection_templates/${form.id}`);
      form = null;
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  async function setOnReturn(v: boolean) {
    try {
      onReturn = !!(await api.patch('/tenant/settings', { require_inspection_on_return: v })).require_inspection_on_return;
      toast.success(t('common.saved'));
    } catch (err) {
      notifyError(err);
    }
  }
  const catNames = (ids: string[]) => (ids.length ? ids.map((id) => categories.find((c) => c.id === id)?.name ?? id).join(', ') : t('checklists.all_products'));
</script>

<svelte:head><title>{t('checklists.title')} · OpenRent</title></svelte:head>

<PageHeader title={t('checklists.title')} description={t('checklists.description')}>
  {#snippet actions()}
    <Button variant="outline" href={to('/maintenance')}>{t('nav.maintenance')}</Button>
    {#if canEdit}<Button onclick={() => edit(null)}><PlusIcon />{t('checklists.new')}</Button>{/if}
  {/snippet}
</PageHeader>

{#if onReturn !== null}
  <Card.Root class="mb-6">
    <Card.Content>
      <Field.Field orientation="horizontal">
        <Switch id="ck-return" checked={onReturn} disabled={!session.can('tenant:write')} onCheckedChange={setOnReturn} />
        <Field.Content>
          <Field.Label for="ck-return">{t('checklists.on_return')}</Field.Label>
          <Field.Description>{t('checklists.on_return_hint')}</Field.Description>
        </Field.Content>
      </Field.Field>
    </Card.Content>
  </Card.Root>
{/if}

<div class="overflow-hidden rounded-lg border">
  <Table.Root>
    <Table.Header class="bg-muted/50">
      <Table.Row><Table.Head>{t('field.name')}</Table.Head><Table.Head>{t('nav.categories')}</Table.Head><Table.Head>{t('checklists.items')}</Table.Head><Table.Head>{t('checklists.version')}</Table.Head><Table.Head></Table.Head></Table.Row>
    </Table.Header>
    <Table.Body>
      {#each templates ?? [] as tpl (tpl.id)}
        <Table.Row class="cursor-pointer" data-testid="checklist-row" onclick={() => canEdit && edit(tpl)}>
          <Table.Cell class="font-medium">{tpl.name}</Table.Cell>
          <Table.Cell>{catNames(tpl.category_ids)}</Table.Cell>
          <Table.Cell class="tabular-nums">{tpl.items.length}</Table.Cell>
          <Table.Cell class="tabular-nums">{tpl.version}</Table.Cell>
          <Table.Cell>{#if !tpl.active}<Badge variant="secondary">{t('checklists.inactive')}</Badge>{/if}</Table.Cell>
        </Table.Row>
      {:else}
        <Table.Row><Table.Cell colspan={5} class="h-24 text-center text-muted-foreground">{templates ? t('checklists.empty') : t('common.loading')}</Table.Cell></Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<Sheet.Root open={!!form} onOpenChange={(v) => !v && (form = null)}>
  <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
    {#if form}
      <form class="flex flex-col gap-5 p-4" onsubmit={save} novalidate>
        <Sheet.Header class="p-0">
          <Sheet.Title>{form.id ? form.name : t('checklists.new')}</Sheet.Title>
          <Sheet.Description>{t('checklists.editor_hint')}</Sheet.Description>
        </Sheet.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="ck-name">{t('field.name')}</Field.Label>
            <Input id="ck-name" bind:value={form.name} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          <Field.Set>
            <Field.Legend variant="label">{t('nav.categories')}</Field.Legend>
            <Field.Description>{form.category_ids.length ? t('checklists.some_categories') : t('checklists.all_products')}</Field.Description>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {#each categories as c (c.id)}
                <Field.Field orientation="horizontal">
                  <Checkbox id={`ck-cat-${c.id}`} checked={form.category_ids.includes(c.id)} onCheckedChange={(v) => form && (form.category_ids = v ? [...form.category_ids, c.id] : form.category_ids.filter((x) => x !== c.id))} />
                  <Field.Label for={`ck-cat-${c.id}`} class="font-normal">{c.name}</Field.Label>
                </Field.Field>
              {/each}
            </div>
          </Field.Set>
          <Field.Set data-invalid={!!errors.items || undefined}>
            <Field.Legend variant="label">{t('checklists.items')}</Field.Legend>
            {#if errors.items}<Field.Error>{errors.items}</Field.Error>{/if}
            {#each form.items as it, i (i)}
              <div class="flex flex-col gap-3 rounded-lg border p-3" data-testid="checklist-item">
                <div class="grid gap-3 sm:grid-cols-2">
                  {#each shopLocales.list as loc, li (loc)}
                    <Field.Field data-invalid={(li === 0 && !!errors[`items[${i}].label`]) || undefined}>
                      <Field.Label for={`ck-${i}-${loc}`}>{t('checklists.item_label', { language: languageName(loc) })}</Field.Label>
                      <Input id={`ck-${i}-${loc}`} value={it.label[loc] ?? ''} oninput={(e) => (it.label = { ...it.label, [loc]: (e.currentTarget as HTMLInputElement).value })} aria-invalid={li === 0 && !!errors[`items[${i}].label`]} />
                      {#if li === 0 && errors[`items[${i}].label`]}<Field.Error>{errors[`items[${i}].label`]}</Field.Error>{/if}
                    </Field.Field>
                  {/each}
                </div>
                <div class="flex flex-wrap items-end gap-3">
                  <Field.Field class="w-36" data-invalid={!!errors[`items[${i}].kind`] || undefined}>
                    <Field.Label for={`ck-${i}-kind`}>{t('checklists.kind')}</Field.Label>
                    <NativeSelect id={`ck-${i}-kind`} class="w-full" bind:value={it.kind}>{#each ['check', 'number', 'text'] as k (k)}<NativeSelectOption value={k}>{t(`checklists.kind.${k}` as any)}</NativeSelectOption>{/each}</NativeSelect>
                    {#if errors[`items[${i}].kind`]}<Field.Error>{errors[`items[${i}].kind`]}</Field.Error>{/if}
                  </Field.Field>
                  {#if it.kind === 'number'}
                    <Field.Field class="w-24">
                      <Field.Label for={`ck-${i}-min`}>{t('checklists.min')}</Field.Label>
                      <Input id={`ck-${i}-min`} type="number" step="any" bind:value={it.min} />
                    </Field.Field>
                    <Field.Field class="w-24" data-invalid={!!errors[`items[${i}].max`] || undefined}>
                      <Field.Label for={`ck-${i}-max`}>{t('checklists.max')}</Field.Label>
                      <Input id={`ck-${i}-max`} type="number" step="any" bind:value={it.max} aria-invalid={!!errors[`items[${i}].max`]} />
                      {#if errors[`items[${i}].max`]}<Field.Error>{errors[`items[${i}].max`]}</Field.Error>{/if}
                    </Field.Field>
                  {/if}
                  {#if it.kind !== 'text'}
                    <Field.Field class="w-44">
                      <Field.Label for={`ck-${i}-fail`}>{t('checklists.on_fail')}</Field.Label>
                      <NativeSelect id={`ck-${i}-fail`} class="w-full" bind:value={it.fail_status}>{#each ['needs_inspection', 'soft_down', 'hard_down'] as s (s)}<NativeSelectOption value={s}>{t(`status.${s}` as any)}</NativeSelectOption>{/each}</NativeSelect>
                    </Field.Field>
                  {/if}
                  <Field.Field orientation="horizontal" class="w-auto">
                    <Switch id={`ck-${i}-req`} bind:checked={it.required} />
                    <Field.Label for={`ck-${i}-req`} class="font-normal">{t('checklists.required')}</Field.Label>
                  </Field.Field>
                  <div class="ml-auto flex gap-1">
                    {#if i > 0}<Button type="button" variant="ghost" size="icon-sm" aria-label={t('checklists.move_up')} onclick={() => move(i)}><ArrowUpIcon /></Button>{/if}
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('checklists.remove_item')} onclick={() => form && (form.items = form.items.filter((_, j) => j !== i))}><XIcon /></Button>
                  </div>
                </div>
              </div>
            {/each}
            <div><Button type="button" variant="outline" size="sm" onclick={() => form && (form.items = [...form.items, blankItem()])}><PlusIcon />{t('checklists.add_item')}</Button></div>
          </Field.Set>
          <Field.Field orientation="horizontal">
            <Switch id="ck-active" bind:checked={form.active} />
            <Field.Label for="ck-active" class="font-normal">{t('checklists.active')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <Sheet.Footer class="flex-row justify-between p-0">
          {#if form.id}<Button type="button" variant="ghost" onclick={archive}>{t('checklists.archive')}</Button>{:else}<span></span>{/if}
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('common.save')}</Button>
        </Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
