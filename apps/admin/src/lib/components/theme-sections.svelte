<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { Separator } from '@openrent/ui/separator';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import LayoutTemplateIcon from '@lucide/svelte/icons/layout-template';
  import { api, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';
  import ThemeSettingField, { type ThemeSetting } from './theme-setting-field.svelte';

  interface Schema {
    type: string;
    name: string;
    settings: ThemeSetting[];
    blocks?: { type: string; name: string; settings: ThemeSetting[] }[];
    max_blocks?: number;
  }
  interface Block {
    id: string;
    type: string;
    settings: Record<string, unknown>;
  }
  interface Section extends Block {
    blocks: Block[];
  }

  /** Home page sections of one theme: order, add, remove, edit settings and blocks, with a live preview. */
  let { theme, onsaved }: { theme: any; onsaved: (theme: any) => void } = $props();

  const schemas = $derived((theme.section_schemas ?? []) as Schema[]);
  const schemaOf = (type: string) => schemas.find((s) => s.type === type);
  const copy = (v: unknown) => JSON.parse(JSON.stringify(v ?? []));
  const defaults = (fields: ThemeSetting[]) =>
    Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.id, f.default]));
  const withDefaults = (list: Section[]): Section[] =>
    list.map((s) => {
      const sc = schemaOf(s.type);
      return {
        ...s,
        settings: { ...defaults(sc?.settings ?? []), ...s.settings },
        blocks: (s.blocks ?? []).map((b) => ({
          ...b,
          settings: {
            ...defaults(sc?.blocks?.find((x) => x.type === b.type)?.settings ?? []),
            ...b.settings,
          },
        })),
      };
    });

  // svelte-ignore state_referenced_locally
  let layout = $state<Section[]>(withDefaults(copy(theme.sections ?? theme.sections_default)));
  // svelte-ignore state_referenced_locally
  let saved = $state(JSON.stringify(layout));
  let selected = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  let previewUrl = $state('');
  let frameKey = $state(0);
  const dirty = $derived(JSON.stringify(layout) !== saved);
  const current = $derived(layout.find((s) => s.id === selected) ?? null);
  const currentIndex = $derived(layout.findIndex((s) => s.id === selected));
  const newId = (type: string) => `${type}-${Math.random().toString(36).slice(2, 7)}`;

  onMount(async () => {
    try {
      previewUrl = (await api.post(`/themes/${theme.id}/actions/preview`)).url;
    } catch (e) {
      notifyError(e);
    }
  });

  function move<T>(list: T[], i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
  }

  function add(sc: Schema) {
    const s: Section = { id: newId(sc.type), type: sc.type, settings: defaults(sc.settings), blocks: [] };
    if (sc.blocks?.[0])
      s.blocks.push({ id: newId('b'), type: sc.blocks[0].type, settings: defaults(sc.blocks[0].settings) });
    layout.push(s);
    selected = s.id;
  }

  function addBlock(s: Section, type: string) {
    const bs = schemaOf(s.type)?.blocks?.find((b) => b.type === type);
    if (bs) s.blocks.push({ id: newId('b'), type, settings: defaults(bs.settings) });
  }

  /** Errors come back as `sections.<i>.settings.<id>` / `sections.<i>.blocks.<j>.settings.<id>`. */
  const err = (path: string) => errors[path];
  const sectionHasError = (i: number) => Object.keys(errors).some((k) => k.startsWith(`sections.${i}.`));

  async function save() {
    saving = true;
    errors = {};
    try {
      const updated = await api.put(`/themes/${theme.id}/sections`, { sections: layout });
      saved = JSON.stringify(layout);
      onsaved(updated);
      frameKey++;
      toast.success(t('sections.saved'));
    } catch (e) {
      errors = fieldErrors(e);
      if (!Object.keys(errors).length) notifyError(e);
      else toast.error(t('sections.invalid'));
    } finally {
      saving = false;
    }
  }

  async function restoreDefault() {
    if (
      !(await confirmAction({
        title: t('sections.reset_title'),
        description: t('sections.reset_description'),
        confirmLabel: t('sections.reset'),
      }))
    )
      return;
    try {
      const updated = await api.put(`/themes/${theme.id}/sections`, { sections: null });
      layout = withDefaults(copy(updated.sections_default));
      saved = JSON.stringify(layout);
      selected = null;
      onsaved(updated);
      frameKey++;
      toast.success(t('sections.reset_done'));
    } catch (e) {
      notifyError(e);
    }
  }

  const title = (s: Section) => {
    const heading = typeof s.settings.heading === 'string' && s.settings.heading ? s.settings.heading : '';
    return heading || schemaOf(s.type)?.name || s.type;
  };
</script>

{#if !schemas.length}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Media variant="icon"><LayoutTemplateIcon /></Empty.Media>
      <Empty.Title>{t('sections.none')}</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <div class="grid gap-4 xl:grid-cols-[minmax(0,28rem)_1fr]">
    <div class="flex flex-col gap-4">
      <Card.Root>
        <Card.Header>
          <Card.Title>{t('sections.title')}</Card.Title>
          <Card.Description>{t('sections.description')}</Card.Description>
          <Card.Action>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}<Button size="sm" variant="outline" {...props}
                    ><PlusIcon />{t('sections.add')}</Button
                  >{/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                {#each schemas as sc (sc.type)}<DropdownMenu.Item onSelect={() => add(sc)}
                    >{sc.name}</DropdownMenu.Item
                  >{/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Card.Action>
        </Card.Header>
        <Card.Content>
          <ol class="flex flex-col gap-1" aria-label={t('sections.title')} data-testid="section-list">
            {#each layout as s, i (s.id)}
              <li
                class={[
                  'flex items-center gap-1 rounded-md border px-2 py-1',
                  s.id === selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted',
                  sectionHasError(i) && 'border-destructive',
                ]}
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 flex-col items-start py-1 text-left"
                  onclick={() => (selected = s.id)}
                  aria-current={s.id === selected ? 'true' : undefined}
                >
                  <span class="truncate text-sm font-medium">{title(s)}</span>
                  <span class="text-muted-foreground text-xs">{schemaOf(s.type)?.name ?? s.type}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === 0}
                  aria-label={t('sections.move_up', { name: title(s) })}
                  onclick={() => move(layout, i, -1)}><ArrowUpIcon /></Button
                >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === layout.length - 1}
                  aria-label={t('sections.move_down', { name: title(s) })}
                  onclick={() => move(layout, i, 1)}><ArrowDownIcon /></Button
                >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('sections.remove', { name: title(s) })}
                  onclick={() => {
                    layout.splice(i, 1);
                    if (selected === s.id) selected = null;
                  }}><Trash2Icon /></Button
                >
              </li>
            {:else}
              <li class="text-muted-foreground px-2 py-4 text-sm">{t('sections.empty')}</li>
            {/each}
          </ol>
        </Card.Content>
        <Card.Footer class="flex-wrap justify-between gap-2">
          <Button variant="ghost" size="sm" onclick={restoreDefault}
            ><RotateCcwIcon />{t('sections.reset')}</Button
          >
          <div class="flex gap-2">
            <Button
              variant="outline"
              disabled={!dirty || saving}
              onclick={() => {
                layout = JSON.parse(saved);
                errors = {};
              }}>{t('themes.discard')}</Button
            >
            <Button disabled={!dirty || saving} onclick={save}
              >{#if saving}<Spinner />{/if}{t('common.save')}</Button
            >
          </div>
        </Card.Footer>
      </Card.Root>

      {#if current}
        {@const sc = schemaOf(current.type)}
        <Card.Root data-testid="section-editor">
          <Card.Header>
            <Card.Title>{sc?.name ?? current.type}</Card.Title>
            {#if dirty}<Card.Action><Badge variant="secondary">{t('sections.unsaved')}</Badge></Card.Action
              >{/if}
          </Card.Header>
          <Card.Content class="flex flex-col gap-6">
            {#each sc?.settings ?? [] as f (f.id)}
              <ThemeSettingField
                setting={f}
                bind:value={current.settings[f.id]}
                error={err(`sections.${currentIndex}.settings.${f.id}`)}
                uid={current.id}
              />
            {/each}
            {#if sc?.blocks?.length}
              <Separator />
              <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="text-sm font-medium">{t('sections.items', { count: current.blocks.length })}</h3>
                  {#if sc.blocks.length === 1}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sc.max_blocks !== undefined && current.blocks.length >= sc.max_blocks}
                      onclick={() => addBlock(current, sc.blocks![0]!.type)}
                      ><PlusIcon />{t('sections.add_item', { name: sc.blocks[0]!.name })}</Button
                    >
                  {:else}
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        {#snippet child({ props })}<Button size="sm" variant="outline" {...props}
                            ><PlusIcon />{t('sections.add_item_generic')}</Button
                          >{/snippet}
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="end">
                        {#each sc.blocks as bs (bs.type)}<DropdownMenu.Item
                            onSelect={() => addBlock(current, bs.type)}>{bs.name}</DropdownMenu.Item
                          >{/each}
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  {/if}
                </div>
                {#if err(`sections.${currentIndex}.blocks`)}<p class="text-destructive text-sm">
                    {err(`sections.${currentIndex}.blocks`)}
                  </p>{/if}
                {#each current.blocks as b, j (b.id)}
                  {@const bs = sc.blocks.find((x) => x.type === b.type)}
                  <Card.Root size="sm" class="bg-muted/30">
                    <Card.Header>
                      <Card.Title class="text-sm">{bs?.name ?? b.type} {j + 1}</Card.Title>
                      <Card.Action class="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={j === 0}
                          aria-label={t('sections.move_up', { name: `${bs?.name ?? b.type} ${j + 1}` })}
                          onclick={() => move(current.blocks, j, -1)}><ArrowUpIcon /></Button
                        >
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={j === current.blocks.length - 1}
                          aria-label={t('sections.move_down', { name: `${bs?.name ?? b.type} ${j + 1}` })}
                          onclick={() => move(current.blocks, j, 1)}><ArrowDownIcon /></Button
                        >
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('sections.remove', { name: `${bs?.name ?? b.type} ${j + 1}` })}
                          onclick={() => current.blocks.splice(j, 1)}><Trash2Icon /></Button
                        >
                      </Card.Action>
                    </Card.Header>
                    <Card.Content class="flex flex-col gap-4">
                      {#each bs?.settings ?? [] as f (f.id)}
                        <ThemeSettingField
                          setting={f}
                          bind:value={b.settings[f.id]}
                          error={err(`sections.${currentIndex}.blocks.${j}.settings.${f.id}`)}
                          uid={b.id}
                        />
                      {/each}
                    </Card.Content>
                  </Card.Root>
                {/each}
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      {:else if layout.length}
        <p class="text-muted-foreground px-1 text-sm">{t('sections.pick')}</p>
      {/if}
    </div>

    <Card.Root class="h-fit gap-0 overflow-hidden py-0 xl:sticky xl:top-4">
      <div class="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span class="text-sm font-medium">{t('sections.preview')}</span>
        <Button variant="ghost" size="sm" onclick={() => frameKey++} aria-label={t('sections.reload')}
          ><RefreshCwIcon />{t('sections.reload')}</Button
        >
      </div>
      {#if previewUrl}
        {#key frameKey}
          <iframe
            title={t('sections.preview')}
            src={previewUrl}
            class="h-[70vh] w-full bg-white"
            data-testid="section-preview"
          ></iframe>
        {/key}
      {:else}
        <div class="flex h-[70vh] items-center justify-center"><Spinner /></div>
      {/if}
      <p class="text-muted-foreground border-t px-4 py-2 text-xs">{t('sections.preview_hint')}</p>
    </Card.Root>
  </div>
{/if}
