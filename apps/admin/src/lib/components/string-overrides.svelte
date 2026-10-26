<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Table from '@openrent/ui/table';
  import * as InputGroup from '@openrent/ui/input-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { Badge } from '@openrent/ui/badge';
  import SearchIcon from '@lucide/svelte/icons/search';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import { LOCALES, LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { api, qs, t, toast, notifyError, fieldErrors, getLocale } from '#lib';
  import { shopLocales } from './shop-locales.svelte.ts';

  /**
   * Settings → Translations (FR-I18N-6): the shop's own wording of storefront, theme, plugin, email and
   * document texts, per language. Placeholders such as {number} must stay; the API checks them.
   */
  let namespaces = $state<{ id: string; kind: string; name: string }[]>([]);
  let ns = $state('storefront');
  let locale = $state('en');
  let q = $state('');
  let changed = $state(false);
  let rows = $state<{ key: string; base: string; english: string; value: string | null }[]>([]);
  let total = $state(0);
  let draft = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});
  let timer: ReturnType<typeof setTimeout> | undefined;

  const label = (n: { kind: string; name: string }) =>
    n.kind === 'theme' ? t('strings.ns.theme', { name: n.name }) : n.kind === 'plugin' ? t('strings.ns.plugin', { name: n.name }) : t(`strings.ns.${n.kind}` as any);

  async function load(more = false) {
    try {
      const r = await api.get(`/strings?${qs({ namespace: ns, locale, q, changed: changed || undefined, limit: 50, offset: more ? rows.length : 0 })}`);
      rows = more ? [...rows, ...r.data] : r.data;
      total = r.total;
      if (!more) {
        draft = {};
        errors = {};
      }
    } catch (err) {
      notifyError(err);
    }
  }

  onMount(async () => {
    try {
      await shopLocales.load();
      locale = shopLocales.list.includes(getLocale()) ? getLocale() : shopLocales.default;
      namespaces = (await api.get('/string_namespaces')).data;
      await load();
    } catch (err) {
      notifyError(err);
    }
  });

  function search() {
    clearTimeout(timer);
    timer = setTimeout(() => load(), 250);
  }

  async function save(key: string, value: string | null) {
    try {
      await api.put(`/strings/${encodeURIComponent(ns)}/${locale}`, { values: { [key]: value } });
      const row = rows.find((r) => r.key === key);
      if (row) row.value = value || null;
      delete draft[key];
      delete errors[key];
      toast.success(value ? t('common.saved') : t('strings.reset_done'));
    } catch (err) {
      const f = fieldErrors(err);
      if (f[`values.${key}`]) errors[key] = f[`values.${key}`]!;
      else notifyError(err);
    }
  }
</script>

<Card.Root data-testid="string-overrides">
  <Card.Header>
    <Card.Title>{t('strings.title')}</Card.Title>
    <Card.Description>{t('strings.hint')}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <div class="grid gap-3 sm:grid-cols-[1fr_12rem]">
      <Field.Field>
        <Field.Label for="str-ns">{t('strings.namespace')}</Field.Label>
        <NativeSelect id="str-ns" class="w-full" value={ns} onchange={(e) => { ns = (e.currentTarget as HTMLSelectElement).value; load(); }}>
          {#each namespaces as n (n.id)}<NativeSelectOption value={n.id}>{label(n)}</NativeSelectOption>{/each}
        </NativeSelect>
      </Field.Field>
      <Field.Field>
        <Field.Label for="str-locale">{t('language.label')}</Field.Label>
        <NativeSelect id="str-locale" class="w-full" value={locale} onchange={(e) => { locale = (e.currentTarget as HTMLSelectElement).value; load(); }}>
          {#each LOCALES as l (l)}<NativeSelectOption value={l}>{LOCALE_NAMES[l as Locale]}</NativeSelectOption>{/each}
        </NativeSelect>
      </Field.Field>
    </div>
    <div class="flex flex-wrap items-center gap-4">
      <InputGroup.Root class="max-w-sm">
        <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
        <InputGroup.Input placeholder={t('strings.search')} aria-label={t('strings.search')} bind:value={q} oninput={search} />
      </InputGroup.Root>
      <Field.Field orientation="horizontal" class="w-auto">
        <Switch id="str-changed" checked={changed} onCheckedChange={(v) => { changed = v; load(); }} />
        <Field.Label for="str-changed" class="font-normal">{t('strings.changed_only')}</Field.Label>
      </Field.Field>
      <span class="text-muted-foreground ml-auto text-sm">{t('strings.count', { count: total })}</span>
    </div>
    <div class="rounded-lg border">
      <Table.Root>
        <Table.Header><Table.Row><Table.Head class="w-1/2">{t('strings.original')}</Table.Head><Table.Head>{t('strings.yours')}</Table.Head></Table.Row></Table.Header>
        <Table.Body>
          {#each rows as r (r.key)}
            {@const value = draft[r.key] ?? r.value ?? ''}
            <Table.Row data-testid="string-row" data-key={r.key}>
              <Table.Cell class="align-top whitespace-normal">
                <div class="text-sm">{r.base}</div>
                {#if locale !== 'en' && r.english !== r.base}<div class="text-muted-foreground mt-1 text-xs">{r.english}</div>{/if}
                <code class="text-muted-foreground mt-1 block text-xs">{r.key}</code>
              </Table.Cell>
              <Table.Cell class="align-top whitespace-normal">
                <Field.Field data-invalid={!!errors[r.key] || undefined}>
                  <Textarea rows={1} class="min-h-9 text-sm" placeholder={r.base} {value} oninput={(e) => (draft[r.key] = (e.currentTarget as HTMLTextAreaElement).value)} aria-label={r.key} aria-invalid={!!errors[r.key]} />
                  {#if errors[r.key]}<Field.Error>{errors[r.key]}</Field.Error>{/if}
                </Field.Field>
                <div class="mt-1 flex items-center gap-1">
                  {#if r.value !== null}<Badge variant="secondary">{t('strings.changed')}</Badge>{/if}
                  {#if draft[r.key] !== undefined && draft[r.key] !== (r.value ?? '')}<Button size="sm" onclick={() => save(r.key, draft[r.key] || null)}>{t('common.save')}</Button>{/if}
                  {#if r.value !== null}<Button size="sm" variant="ghost" onclick={() => save(r.key, null)}><RotateCcwIcon />{t('strings.reset')}</Button>{/if}
                </div>
              </Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={2} class="text-muted-foreground h-20 text-center">{t('strings.none')}</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
    {#if rows.length < total}<div><Button variant="outline" onclick={() => load(true)}>{t('strings.more')}</Button></div>{/if}
  </Card.Content>
</Card.Root>
