<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';
  import { to } from '#lib/nav.ts';
  import { shopLocales } from './shop-locales.svelte.ts';

  /**
   * The shop's own texts in a theme (settings and home page sections) per storefront language.
   * Empty fields show the default-language text to customers.
   */
  let { theme, onsaved }: { theme: any; onsaved: (theme: any) => void } = $props();
  const TRANSLATABLE = ['text', 'textarea', 'link'];
  // svelte-ignore state_referenced_locally
  let lang = $state(shopLocales.others[0] ?? '');
  // svelte-ignore state_referenced_locally
  let values = $state<Record<string, string>>({ ...(theme.content_translations?.[shopLocales.others[0] ?? ''] ?? {}) });
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  interface Row {
    path: string;
    label: string;
    base: string;
    type: string;
  }
  const rows = $derived.by(() => {
    const out: Row[] = [];
    for (const g of theme.settings_schema ?? []) {
      for (const s of g.settings) {
        if (TRANSLATABLE.includes(s.type)) out.push({ path: `settings.${s.id}`, label: `${g.name} › ${s.label}`, base: String(theme.settings?.[s.id] ?? theme.defaults?.[s.id] ?? ''), type: s.type });
      }
    }
    const layout = theme.sections ?? theme.sections_default ?? [];
    for (const sec of layout) {
      const schema = (theme.section_schemas ?? []).find((x: any) => x.type === sec.type);
      if (!schema) continue;
      for (const f of schema.settings) {
        if (TRANSLATABLE.includes(f.type)) out.push({ path: `sections.${sec.id}.${f.id}`, label: `${schema.name} › ${f.label}`, base: String(sec.settings?.[f.id] ?? f.default ?? ''), type: f.type });
      }
      (sec.blocks ?? []).forEach((b: any, j: number) => {
        const bs = schema.blocks?.find((x: any) => x.type === b.type);
        for (const f of bs?.settings ?? []) {
          if (TRANSLATABLE.includes(f.type)) out.push({ path: `sections.${sec.id}.blocks.${b.id}.${f.id}`, label: `${schema.name} › ${bs.name} ${j + 1} › ${f.label}`, base: String(b.settings?.[f.id] ?? f.default ?? ''), type: f.type });
        }
      });
    }
    return out;
  });

  function pick(l: string) {
    lang = l;
    values = { ...(theme.content_translations?.[l] ?? {}) };
    errors = {};
  }

  async function save() {
    saving = true;
    errors = {};
    // Send every row so cleared fields are removed too.
    const body = Object.fromEntries(rows.map((r) => [r.path, values[r.path]?.trim() ? values[r.path]! : null]));
    try {
      const updated = await api.put(`/themes/${theme.id}/content/${lang}`, { values: body });
      onsaved(updated);
      values = { ...(updated.content_translations?.[lang] ?? {}) };
      toast.success(t('translations.saved'));
    } catch (e) {
      errors = Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^values\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(e);
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root data-testid="theme-content-translations">
  <Card.Header>
    <Card.Title>{t('themes.content_title')}</Card.Title>
    <Card.Description>{t('themes.content_hint', { language: t(`language.${shopLocales.default}` as any) })}</Card.Description>
    {#if shopLocales.others.length}
      <Card.Action>
        <NativeSelect value={lang} onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)} aria-label={t('language.label')}>
          {#each shopLocales.others as l (l)}<NativeSelectOption value={l}>{LOCALE_NAMES[l as Locale] ?? l}</NativeSelectOption>{/each}
        </NativeSelect>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content>
    {#if !shopLocales.others.length}
      <p class="text-muted-foreground text-sm">{t('translations.none')} <a class="underline underline-offset-4" href={to('/settings')}>{t('translations.none_link')}</a></p>
    {:else}
      <div class="rounded-lg border">
        <Table.Root>
          <Table.Header><Table.Row><Table.Head class="w-1/2">{t('themes.col.default')}</Table.Head><Table.Head>{LOCALE_NAMES[lang as Locale] ?? lang}</Table.Head></Table.Row></Table.Header>
          <Table.Body>
            {#each rows as r (r.path)}
              <Table.Row>
                <Table.Cell class="align-top whitespace-normal">
                  <div class="text-muted-foreground text-xs">{r.label}</div>
                  <div class="mt-1">{r.base || '—'}</div>
                </Table.Cell>
                <Table.Cell class="align-top">
                  <Field.Field data-invalid={!!errors[r.path] || undefined}>
                    {#if r.type === 'textarea'}
                      <Textarea lang={lang} placeholder={r.base} bind:value={values[r.path]} aria-label={r.label} aria-invalid={!!errors[r.path]} />
                    {:else}
                      <Input lang={lang} type={r.type === 'link' ? 'url' : 'text'} placeholder={r.base} bind:value={values[r.path]} aria-label={r.label} aria-invalid={!!errors[r.path]} />
                    {/if}
                    {#if errors[r.path]}<Field.Error>{errors[r.path]}</Field.Error>{/if}
                  </Field.Field>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}
  </Card.Content>
  {#if shopLocales.others.length}
    <Card.Footer class="justify-end"><Button onclick={save} disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button></Card.Footer>
  {/if}
</Card.Root>
