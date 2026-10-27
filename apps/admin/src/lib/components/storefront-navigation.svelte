<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Tabs from '@openrent/ui/tabs';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Spinner } from '@openrent/ui/spinner';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';
  import { shopLocales } from './shop-locales.svelte.ts';

  /**
   * The storefront's header and footer menus: links to categories, pages, products, the home page,
   * search or any address. An empty header menu leaves the theme's own (the categories).
   */
  type Kind = 'home' | 'search' | 'category' | 'page' | 'product' | 'url';
  interface Item {
    kind: Kind;
    target: string;
    label: string;
    translations: Record<string, string>;
  }
  type Menu = 'header' | 'footer';
  const KINDS: Kind[] = ['category', 'page', 'product', 'url', 'home', 'search'];
  let menus = $state<Record<Menu, Item[]> | null>(null);
  let tab = $state<Menu>('header');
  let options = $state<Record<'category' | 'page' | 'product', { id: string; name: string }[]>>({ category: [], page: [], product: [] });
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  const toItem = (i: any): Item => ({ kind: i.kind, target: i.target ?? '', label: i.label ?? '', translations: { ...(i.translations ?? {}) } });

  onMount(async () => {
    try {
      const [nav, cats, pages, products] = await Promise.all([
        api.get('/storefront_navigation'),
        api.get('/categories?limit=200'),
        api.get('/storefront_pages'),
        api.get('/products?limit=100&filter[visibility]=public&sort=name'),
        shopLocales.load(),
      ]);
      options = {
        category: cats.data.map((c: any) => ({ id: c.id, name: c.name })),
        page: pages.data.map((p: any) => ({ id: p.id, name: p.status === 'published' ? p.title : t('pages.draft_option', { title: p.title }) })),
        product: products.data.map((p: any) => ({ id: p.id, name: p.name })),
      };
      menus = { header: nav.header.map(toItem), footer: nav.footer.map(toItem) };
    } catch (e) {
      notifyError(e);
    }
  });

  function move(list: Item[], i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
  }

  async function save() {
    if (!menus) return;
    saving = true;
    errors = {};
    const out = (list: Item[]) =>
      list.map((i) => ({
        kind: i.kind,
        target: ['home', 'search'].includes(i.kind) ? null : i.target.trim() || null,
        label: i.label.trim() || null,
        translations: Object.fromEntries(Object.entries(i.translations).filter(([, v]) => v.trim()).map(([l, v]) => [l, v.trim()])),
      }));
    try {
      const r = await api.put('/storefront_navigation', { header: out(menus.header), footer: out(menus.footer) });
      menus = { header: r.header.map(toItem), footer: r.footer.map(toItem) };
      toast.success(t('common.saved'));
    } catch (e) {
      errors = fieldErrors(e);
      if (!Object.keys(errors).length) notifyError(e);
      else {
        const first = Object.keys(errors)[0]!;
        if (first.startsWith('navigation.footer')) tab = 'footer';
      }
    } finally {
      saving = false;
    }
  }

  const err = (menu: Menu, i: number, k: string) => errors[`navigation.${menu}.${i}.${k}`];
  const needsLabel = (k: Kind) => k === 'home' || k === 'search' || k === 'url';
</script>

<Card.Root data-testid="storefront-navigation">
  <Card.Header>
    <Card.Title>{t('menus.title')}</Card.Title>
    <Card.Description>{t('menus.hint')}</Card.Description>
  </Card.Header>
  {#if !menus}
    <Card.Content><Skeleton class="h-32" /></Card.Content>
  {:else}
    <Card.Content>
      <Tabs.Root bind:value={tab}>
        <Tabs.List>
          <Tabs.Trigger value="header">{t('menus.header')} ({menus.header.length})</Tabs.Trigger>
          <Tabs.Trigger value="footer">{t('menus.footer')} ({menus.footer.length})</Tabs.Trigger>
        </Tabs.List>
        {#each ['header', 'footer'] as const as menu (menu)}
          <Tabs.Content value={menu} class="flex flex-col gap-3 pt-2">
            {#if errors[`navigation.${menu}`]}<p class="text-destructive text-sm">{errors[`navigation.${menu}`]}</p>{/if}
            {#each menus[menu] as item, i (i)}
              <fieldset class="flex flex-col gap-3 rounded-lg border p-3" data-testid="menu-item">
                <legend class="sr-only">{t('menus.link_n', { n: i + 1 })}</legend>
                <div class="grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-start">
                  <Field.Field>
                    <Field.Label for="mi-kind-{menu}-{i}">{t('menus.kind')}</Field.Label>
                    <NativeSelect id="mi-kind-{menu}-{i}" bind:value={item.kind} onchange={() => (item.target = '')}>
                      {#each KINDS as k (k)}<NativeSelectOption value={k}>{t(`menus.kind.${k}` as any)}</NativeSelectOption>{/each}
                    </NativeSelect>
                  </Field.Field>
                  <Field.Field data-invalid={!!err(menu, i, 'target') || undefined}>
                    {#if item.kind === 'url'}
                      <Field.Label for="mi-target-{menu}-{i}">{t('menus.address')}</Field.Label>
                      <Input id="mi-target-{menu}-{i}" placeholder={t('menus.address_placeholder')} bind:value={item.target} aria-invalid={!!err(menu, i, 'target')} />
                    {:else if item.kind === 'category' || item.kind === 'page' || item.kind === 'product'}
                      <Field.Label for="mi-target-{menu}-{i}">{t(`menus.kind.${item.kind}` as any)}</Field.Label>
                      <NativeSelect id="mi-target-{menu}-{i}" bind:value={item.target} aria-invalid={!!err(menu, i, 'target')}>
                        <NativeSelectOption value="">{t('menus.choose')}</NativeSelectOption>
                        {#each options[item.kind] as o (o.id)}<NativeSelectOption value={o.id}>{o.name}</NativeSelectOption>{/each}
                      </NativeSelect>
                    {/if}
                    {#if err(menu, i, 'target')}<Field.Error>{err(menu, i, 'target')}</Field.Error>{/if}
                  </Field.Field>
                  <Field.Field data-invalid={!!err(menu, i, 'label') || undefined}>
                    <Field.Label for="mi-label-{menu}-{i}">{t('menus.label')}{shopLocales.others.length ? ` (${LOCALE_NAMES[shopLocales.default as Locale]})` : ''}</Field.Label>
                    <Input id="mi-label-{menu}-{i}" maxlength={60} placeholder={needsLabel(item.kind) ? '' : t('menus.label_auto')} bind:value={item.label} aria-invalid={!!err(menu, i, 'label')} />
                    {#if err(menu, i, 'label')}<Field.Error>{err(menu, i, 'label')}</Field.Error>{/if}
                  </Field.Field>
                  <div class="flex gap-1 sm:pt-6">
                    <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={t('menus.move_up', { n: i + 1 })} onclick={() => move(menus![menu], i, -1)}><ArrowUpIcon /></Button>
                    <Button variant="ghost" size="icon-sm" disabled={i === menus[menu].length - 1} aria-label={t('menus.move_down', { n: i + 1 })} onclick={() => move(menus![menu], i, 1)}><ArrowDownIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={t('menus.remove', { n: i + 1 })} onclick={() => menus![menu].splice(i, 1)}><Trash2Icon /></Button>
                  </div>
                </div>
                {#if shopLocales.others.length}
                  <div class="grid gap-3 sm:grid-cols-3">
                    {#each shopLocales.others as l (l)}
                      <Field.Field data-invalid={!!err(menu, i, `translations.${l}`) || undefined}>
                        <Field.Label for="mi-tr-{menu}-{i}-{l}" class="font-normal">{t('menus.label')} ({LOCALE_NAMES[l as Locale] ?? l})</Field.Label>
                        <Input id="mi-tr-{menu}-{i}-{l}" lang={l} maxlength={60} placeholder={item.label} bind:value={item.translations[l]} />
                        {#if err(menu, i, `translations.${l}`)}<Field.Error>{err(menu, i, `translations.${l}`)}</Field.Error>{/if}
                      </Field.Field>
                    {/each}
                  </div>
                {/if}
              </fieldset>
            {:else}
              <p class="text-muted-foreground text-sm">{menu === 'header' ? t('menus.header_empty') : t('menus.footer_empty')}</p>
            {/each}
            <div><Button variant="outline" size="sm" onclick={() => menus![menu].push({ kind: 'category', target: '', label: '', translations: {} })}><PlusIcon />{t('menus.add')}</Button></div>
          </Tabs.Content>
        {/each}
      </Tabs.Root>
    </Card.Content>
    <Card.Footer><Button onclick={save} disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button></Card.Footer>
  {/if}
</Card.Root>
