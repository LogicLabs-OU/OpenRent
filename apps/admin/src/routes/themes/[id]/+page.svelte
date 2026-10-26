<script lang="ts">
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Tabs from '@openrent/ui/tabs';
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import * as InputGroup from '@openrent/ui/input-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Slider } from '@openrent/ui/slider';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader } from '@openrent/ui/openrent';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import RocketIcon from '@lucide/svelte/icons/rocket';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import SearchIcon from '@lucide/svelte/icons/search';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import { api, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';
  import ThemeSettingField, { type ThemeSetting } from '#lib/components/theme-setting-field.svelte';
  import { shopLocales } from '#lib/components/shop-locales.svelte.ts';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import ThemeSections from '#lib/components/theme-sections.svelte';
  import ThemeContentTranslations from '#lib/components/theme-content-translations.svelte';

  const id = $derived(page.params.id!);
  let theme = $state<any>(null);
  let values = $state<Record<string, unknown>>({});
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  let locale = $state('en');
  let overrides = $state<Record<string, string>>({});
  let stringErrors = $state<Record<string, string>>({});
  let filter = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  async function load() {
    try {
      await shopLocales.load();
      if (!theme) locale = shopLocales.default;
      theme = await api.get(`/themes/${id}`);
      reset();
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    void id;
    load();
  });

  function reset() {
    values = { ...theme.defaults, ...theme.settings };
    errors = {};
    overrides = { ...(theme.translations?.[locale] ?? {}) };
    stringErrors = {};
  }

  const dirty = $derived(theme ? JSON.stringify({ ...theme.defaults, ...theme.settings }) !== JSON.stringify(values) : false);

  async function save() {
    saving = true;
    errors = {};
    // Values equal to the default are stored as "use default" so theme updates can change them.
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) settings[k] = JSON.stringify(v) === JSON.stringify(theme.defaults[k]) ? null : v;
    try {
      theme = await api.patch(`/themes/${id}/settings`, { settings });
      reset();
      toast.success(t('common.saved'));
    } catch (e) {
      errors = Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^settings\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(e);
    } finally {
      saving = false;
    }
  }

  async function saveStrings() {
    saving = true;
    stringErrors = {};
    const current = theme.translations?.[locale] ?? {};
    const strings: Record<string, string | null> = {};
    for (const k of new Set([...Object.keys(current), ...Object.keys(overrides)])) {
      const v = overrides[k]?.trim() ?? '';
      if ((current[k] ?? '') !== v) strings[k] = v || null;
    }
    try {
      theme = await api.patch(`/themes/${id}/translations/${locale}`, { strings });
      reset();
      toast.success(t('common.saved'));
    } catch (e) {
      stringErrors = Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^strings\./, ''), v]));
      if (!Object.keys(stringErrors).length) notifyError(e);
    } finally {
      saving = false;
    }
  }

  async function preview() {
    const tab = window.open('about:blank', '_blank');
    try {
      const r = await api.post(`/themes/${id}/actions/preview`);
      if (tab) tab.location.href = r.url;
    } catch (e) {
      tab?.close();
      notifyError(e);
    }
  }

  async function publish() {
    if (!(await confirmAction({ title: t('themes.publish_title', { name: theme.name }), description: t('themes.publish_description'), confirmLabel: t('themes.publish') }))) return;
    try {
      theme = await api.post(`/themes/${id}/actions/publish`);
      toast.success(t('themes.published', { name: theme.name }));
    } catch (e) {
      notifyError(e);
    }
  }

  async function exportSettings() {
    try {
      const data = await api.get(`/themes/${id}/settings/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `theme-${id}-settings.json` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notifyError(e);
    }
  }

  async function importSettings(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!file) return;
    let body: any;
    try {
      body = JSON.parse(await file.text());
    } catch {
      toast.error(t('themes.import_invalid'));
      return;
    }
    if (!(await confirmAction({ title: t('themes.import_title'), description: t('themes.import_description'), confirmLabel: t('themes.import') }))) return;
    try {
      theme = await api.post(`/themes/${id}/settings/import`, body);
      reset();
      toast.success(t('themes.imported'));
    } catch (err) {
      const fe = fieldErrors(err);
      toast.error(Object.values(fe)[0] ?? (err as Error).message);
    }
  }

  const strings = $derived.by(() => {
    const en: Record<string, string> = theme?.strings?.en ?? {};
    const q = filter.toLowerCase();
    return Object.entries(en).filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q) || (overrides[k] ?? '').toLowerCase().includes(q));
  });
  const groups = $derived((theme?.settings_schema ?? []) as { name: string; settings: ThemeSetting[] }[]);
</script>

<svelte:head><title>{theme?.name ?? t('nav.themes')} · OpenRent</title></svelte:head>

{#if !theme}
  <Skeleton class="mb-6 h-10 w-64" />
  <Skeleton class="h-96 rounded-xl" />
{:else}
  <PageHeader title={theme.name} description={t('themes.byline', { version: theme.version, author: theme.author })}>
    {#if theme.live}<Badge class="gap-1"><CircleCheckIcon class="size-3" />{t('themes.live')}</Badge>{/if}
    {#snippet actions()}
      <Button variant="outline" onclick={preview}><EyeIcon />{t('themes.preview')}</Button>
      {#if !theme.live}<Button variant="outline" disabled={theme.status !== 'ok'} onclick={publish}><RocketIcon />{t('themes.publish')}</Button>{/if}
    {/snippet}
  </PageHeader>

  <Tabs.Root value="settings">
    <Tabs.List class="mb-4">
      <Tabs.Trigger value="settings">{t('themes.tab.settings')}</Tabs.Trigger>
      {#if theme.section_schemas?.length}<Tabs.Trigger value="sections">{t('themes.tab.sections')}</Tabs.Trigger>{/if}
      {#if shopLocales.list.length > 1}<Tabs.Trigger value="translations">{t('themes.tab.translations')}</Tabs.Trigger>{/if}
      <Tabs.Trigger value="texts">{t('themes.tab.texts')}</Tabs.Trigger>
      <Tabs.Trigger value="backup">{t('themes.tab.backup')}</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="translations" class="max-w-5xl">
      <ThemeContentTranslations {theme} onsaved={(updated) => (theme = updated)} />
    </Tabs.Content>

    <Tabs.Content value="sections">
      <ThemeSections {theme} onsaved={(updated) => (theme = updated)} />
    </Tabs.Content>

    <Tabs.Content value="settings" class="max-w-3xl">
      <div class="flex flex-col gap-4">
        {#each groups as group (group.name)}
          <Card.Root>
            <Card.Header><Card.Title>{group.name}</Card.Title></Card.Header>
            <Card.Content>
              <Field.Group>
                {#each group.settings as st (st.id)}<ThemeSettingField setting={st} bind:value={values[st.id]} error={errors[st.id]} uid="theme" />{/each}
              </Field.Group>
            </Card.Content>
          </Card.Root>
        {/each}
        <div class="bg-background/95 sticky bottom-0 flex justify-end gap-2 border-t py-3 backdrop-blur">
          <Button variant="ghost" disabled={!dirty || saving} onclick={reset}><RotateCcwIcon />{t('themes.discard')}</Button>
          <Button disabled={!dirty || saving} onclick={save}>{#if saving}<Spinner />{/if}{t('common.save')}</Button>
        </div>
      </div>
    </Tabs.Content>

    <Tabs.Content value="texts">
      <Card.Root>
        <Card.Header>
          <Card.Title>{t('themes.texts_title')}</Card.Title>
          <Card.Description>{t('themes.texts_hint')}</Card.Description>
          <Card.Action class="flex gap-2">
            {#if shopLocales.list.length > 1}
              <!-- The shop's storefront languages; each has its own text overrides. -->
              <NativeSelect bind:value={locale} onchange={reset} aria-label={t('themes.locale')}>{#each shopLocales.list as l (l)}<NativeSelectOption value={l}>{LOCALE_NAMES[l as Locale] ?? l}</NativeSelectOption>{/each}</NativeSelect>
            {/if}
          </Card.Action>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          <InputGroup.Root class="sm:w-80">
            <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
            <InputGroup.Input placeholder={t('themes.texts_search')} bind:value={filter} aria-label={t('themes.texts_search')} />
          </InputGroup.Root>
          <div class="rounded-lg border">
            <Table.Root>
              <Table.Header><Table.Row><Table.Head class="w-1/2">{t('themes.col.default')}</Table.Head><Table.Head>{t('themes.col.yours')}</Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {#each strings as [key, text] (key)}
                  <Table.Row>
                    <Table.Cell class="align-top whitespace-normal">
                      <div>{theme.strings[locale]?.[key] ?? text}</div>
                      <code class="text-muted-foreground text-xs">{key}</code>
                    </Table.Cell>
                    <Table.Cell class="align-top">
                      <Input value={overrides[key] ?? ''} placeholder={theme.strings[locale]?.[key] ?? text} oninput={(e) => (overrides[key] = (e.currentTarget as HTMLInputElement).value)} aria-label={key} aria-invalid={!!stringErrors[key]} />
                      {#if stringErrors[key]}<p class="text-destructive mt-1 text-xs">{stringErrors[key]}</p>{/if}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        </Card.Content>
        <Card.Footer class="justify-end"><Button disabled={saving} onclick={saveStrings}>{#if saving}<Spinner />{/if}{t('common.save')}</Button></Card.Footer>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="backup" class="max-w-3xl">
      <Card.Root>
        <Card.Header><Card.Title>{t('themes.backup_title')}</Card.Title><Card.Description>{t('themes.backup_hint')}</Card.Description></Card.Header>
        <Card.Content class="flex flex-wrap gap-2">
          <Button variant="outline" onclick={exportSettings}><DownloadIcon />{t('themes.export')}</Button>
          <Button variant="outline" onclick={() => fileInput?.click()}><UploadIcon />{t('themes.import')}</Button>
          <input bind:this={fileInput} type="file" accept="application/json,.json" class="hidden" onchange={importSettings} />
        </Card.Content>
      </Card.Root>
      {#if theme.problems.length}
        <Alert.Root variant="destructive" class="mt-4"><Alert.Title>{t('themes.incompatible')}</Alert.Title><Alert.Description>{theme.problems.join('; ')}</Alert.Description></Alert.Root>
      {/if}
    </Tabs.Content>
  </Tabs.Root>
{/if}
