<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import FolderTreeIcon from '@lucide/svelte/icons/folder-tree';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, session } from '#lib';
  import { shopLocales } from '#lib/components/shop-locales.svelte.ts';
  import LanguageTabs from '#lib/components/language-tabs.svelte';

  /** Storefront categories: order, names and their translations. */
  let categories = $state<any[] | null>(null);
  let edit = $state<{ id: string | null; name: string; slug: string; translations: Record<string, string>; seo: Record<string, { title: string; description: string }> } | null>(null);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  async function load() {
    categories = (await api.get('/categories?limit=200')).data.sort((a: any, b: any) => a.position - b.position || a.name.localeCompare(b.name));
  }
  onMount(() => {
    Promise.all([load(), shopLocales.load()]).catch(notifyError);
  });

  function open(c: any | null) {
    errors = {};
    edit = {
      id: c?.id ?? null,
      name: c?.name ?? '',
      slug: c?.slug ?? '',
      translations: Object.fromEntries(shopLocales.others.map((l) => [l, c?.translations?.[l]?.name ?? ''])),
      // Search engine texts: the default language's in `seo`, the others' beside the translated name.
      seo: Object.fromEntries(
        shopLocales.list.map((l, i) => [l, i === 0 ? { title: c?.seo?.title ?? '', description: c?.seo?.description ?? '' } : { title: c?.translations?.[l]?.seo_title ?? '', description: c?.translations?.[l]?.seo_description ?? '' }]),
      ),
    };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!edit) return;
    saving = true;
    errors = {};
    const current = categories?.find((c) => c.id === edit!.id);
    const translations = { ...(current?.translations ?? {}) };
    for (const l of shopLocales.others) {
      const own: Record<string, string> = { name: edit.translations[l]?.trim() ?? '', seo_title: edit.seo[l]?.title.trim() ?? '', seo_description: edit.seo[l]?.description.trim() ?? '' };
      const kept = Object.fromEntries(Object.entries({ ...(translations[l] ?? {}), ...own }).filter(([, v]) => typeof v !== 'string' || v));
      if (Object.keys(kept).length) translations[l] = kept;
      else delete translations[l];
    }
    const base = edit.seo[shopLocales.default] ?? { title: '', description: '' };
    const seo = { ...(base.title.trim() ? { title: base.title.trim() } : {}), ...(base.description.trim() ? { description: base.description.trim() } : {}) };
    const body = { name: edit.name, ...(edit.slug ? { slug: edit.slug } : {}), translations, seo };
    try {
      if (edit.id) await api.patch(`/categories/${edit.id}`, body);
      else await api.post('/categories', { ...body, position: categories?.length ?? 0 });
      toast.success(t('common.saved'));
      edit = null;
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  async function move(i: number, by: number) {
    if (!categories) return;
    const list = [...categories];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    categories = list;
    try {
      await Promise.all(list.map((c, position) => (c.position === position ? null : api.patch(`/categories/${c.id}`, { position }))));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function remove(c: any) {
    if (!(await confirmAction({ title: t('categories.delete_title', { name: c.name }), description: t('categories.delete_description'), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`/categories/${c.id}`);
      toast.success(t('common.removed'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  const canEdit = $derived(session.can('catalog:write'));
</script>

<svelte:head><title>{t('nav.categories')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.categories')} description={t('categories.description')}>
  {#snippet actions()}{#if canEdit}<Button onclick={() => open(null)}><PlusIcon />{t('categories.new')}</Button>{/if}{/snippet}
</PageHeader>

{#if !categories}
  <Spinner />
{:else if !categories.length}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Media variant="icon"><FolderTreeIcon /></Empty.Media>
      <Empty.Title>{t('categories.empty')}</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <Card.Root class="py-0">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{t('field.name')}</Table.Head>
          <Table.Head>{t('categories.slug')}</Table.Head>
          <Table.Head>{t('translations.title')}</Table.Head>
          <Table.Head class="w-40"><span class="sr-only">{t('common.more_actions')}</span></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each categories as c, i (c.id)}
          <Table.Row data-testid="category-row">
            <Table.Cell class="font-medium">{c.name}</Table.Cell>
            <Table.Cell class="text-muted-foreground font-mono text-xs">{c.slug}</Table.Cell>
            <Table.Cell>
              <div class="flex flex-wrap gap-1">
                {#each shopLocales.others as l (l)}
                  <Badge variant={c.translations?.[l]?.name ? 'secondary' : 'outline'} class={c.translations?.[l]?.name ? '' : 'text-muted-foreground'} title={LOCALE_NAMES[l as Locale]}>{l.toUpperCase()}</Badge>
                {/each}
              </div>
            </Table.Cell>
            <Table.Cell class="text-right">
              {#if canEdit}
                <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={t('sections.move_up', { name: c.name })} onclick={() => move(i, -1)}><ArrowUpIcon /></Button>
                <Button variant="ghost" size="icon-sm" disabled={i === categories.length - 1} aria-label={t('sections.move_down', { name: c.name })} onclick={() => move(i, 1)}><ArrowDownIcon /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('categories.edit', { name: c.name })} onclick={() => open(c)}><PencilIcon /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('categories.delete_title', { name: c.name })} onclick={() => remove(c)}><Trash2Icon /></Button>
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </Card.Root>
{/if}

<Dialog.Root open={!!edit} onOpenChange={(v) => !v && (edit = null)}>
  <Dialog.Content class="max-h-[90svh] overflow-y-auto">
    {#if edit}
      <form class="flex flex-col gap-4" onsubmit={save}>
        <Dialog.Header>
          <Dialog.Title>{edit.id ? t('categories.edit', { name: edit.name }) : t('categories.new')}</Dialog.Title>
        </Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="cat-name">{t('field.name')}{shopLocales.others.length ? ` (${LOCALE_NAMES[shopLocales.default as Locale]})` : ''}</Field.Label>
            <Input id="cat-name" bind:value={edit.name} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!errors.slug || undefined}>
            <Field.Label for="cat-slug">{t('categories.slug')}</Field.Label>
            <Input id="cat-slug" class="font-mono" placeholder={t('categories.slug_auto')} bind:value={edit.slug} aria-invalid={!!errors.slug} />
            {#if errors.slug}<Field.Error>{errors.slug}</Field.Error>{:else}<Field.Description>{t('categories.slug_hint')}</Field.Description>{/if}
          </Field.Field>
          {#each shopLocales.others as l (l)}
            <Field.Field>
              <Field.Label for={`cat-${l}`}>{t('field.name')} ({LOCALE_NAMES[l as Locale]})</Field.Label>
              <Input id={`cat-${l}`} lang={l} placeholder={edit.name} bind:value={edit.translations[l]} />
            </Field.Field>
          {/each}
          <Field.Set>
            <Field.Legend variant="label">{t('seo.search_engines')}</Field.Legend>
            <LanguageTabs locales={shopLocales.list}>
              {#snippet children(l, isDefault)}
                <Field.Group>
                  <Field.Field data-invalid={(isDefault && !!errors['seo.title']) || undefined}>
                    <Field.Label for={`cat-seo-t-${l}`}>{t('product.seo_title')}</Field.Label>
                    <Input id={`cat-seo-t-${l}`} lang={l} maxlength={70} placeholder={isDefault ? edit!.name : edit!.translations[l] || edit!.name} bind:value={edit!.seo[l]!.title} />
                    {#if isDefault && errors['seo.title']}<Field.Error>{errors['seo.title']}</Field.Error>{/if}
                  </Field.Field>
                  <Field.Field data-invalid={(isDefault && !!errors['seo.description']) || undefined}>
                    <Field.Label for={`cat-seo-d-${l}`}>{t('product.seo_description')}</Field.Label>
                    <Textarea id={`cat-seo-d-${l}`} lang={l} maxlength={160} bind:value={edit!.seo[l]!.description} />
                    {#if isDefault && errors['seo.description']}<Field.Error>{errors['seo.description']}</Field.Error>{:else}<Field.Description>{t('product.seo_hint', { count: edit!.seo[l]!.description.length })}</Field.Description>{/if}
                  </Field.Field>
                </Field.Group>
              {/snippet}
            </LanguageTabs>
          </Field.Set>
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (edit = null)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
