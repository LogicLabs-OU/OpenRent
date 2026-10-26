<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import CodeIcon from '@lucide/svelte/icons/code';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';
  import { shopLocales } from './shop-locales.svelte.ts';

  /** The shop's own CSS and header/footer HTML, used by whichever theme is live (FR-SF-4). */
  let open = $state(false);
  type Html = { header_html?: string; footer_html?: string };
  let code = $state<{ css: string; header_html: string; footer_html: string; translations: Record<string, Html> }>({ css: '', header_html: '', footer_html: '', translations: {} });
  /** Header and footer HTML can differ per storefront language; empty falls back to the default. */
  let lang = $state('');
  const isDefault = $derived(!lang || lang === shopLocales.default);
  let errors = $state<Record<string, string>>({});
  let warnings = $state<Record<string, string>>({});
  let saving = $state(false);

  async function show() {
    try {
      const [c] = await Promise.all([api.get('/storefront_code'), shopLocales.load()]);
      code = { css: c.css, header_html: c.header_html, footer_html: c.footer_html, translations: c.translations ?? {} };
      lang = shopLocales.default;
      errors = {};
      warnings = {};
      open = true;
    } catch (e) {
      notifyError(e);
    }
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    errors = {};
    try {
      const r = await api.put('/storefront_code', code);
      code = { css: r.css, header_html: r.header_html, footer_html: r.footer_html, translations: r.translations ?? {} };
      warnings = Object.fromEntries(r.warnings.map((w: any) => [w.field.replace(/^translations\.\w+\./, ''), w.message]));
      toast.success(t('code.saved'));
      if (!r.warnings.length) open = false;
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  const FIELDS = [
    { key: 'css', label: 'code.css', hint: 'code.css_hint', rows: 12 },
    { key: 'header_html', label: 'code.header', hint: 'code.html_hint', rows: 6 },
    { key: 'footer_html', label: 'code.footer', hint: 'code.html_hint', rows: 6 },
  ] as const;
</script>

<Card.Root class="mt-6" data-testid="custom-code">
  <Card.Header>
    <Card.Title>{t('code.title')}</Card.Title>
    <Card.Description>{t('code.description')}</Card.Description>
    <Card.Action><Button variant="outline" onclick={show}><CodeIcon />{t('code.edit')}</Button></Card.Action>
  </Card.Header>
</Card.Root>

<Sheet.Root bind:open>
  <Sheet.Content class="w-full gap-0 data-[side=right]:sm:max-w-2xl">
    <form class="flex h-full flex-col" onsubmit={save}>
      <Sheet.Header>
        <Sheet.Title>{t('code.title')}</Sheet.Title>
        <Sheet.Description>{t('code.sheet_hint')}</Sheet.Description>
      </Sheet.Header>
      <div class="flex-1 overflow-y-auto px-4">
        <Field.Group>
          {#each FIELDS as f, i (f.key)}
            {#if i === 1 && shopLocales.list.length > 1}
              <Field.Field orientation="horizontal">
                <Field.Label for="code-lang">{t('code.html_language')}</Field.Label>
                <NativeSelect id="code-lang" bind:value={lang}>
                  {#each shopLocales.list as l (l)}<NativeSelectOption value={l}>{LOCALE_NAMES[l as Locale] ?? l}</NativeSelectOption>{/each}
                </NativeSelect>
              </Field.Field>
            {/if}
            <Field.Field data-invalid={!!errors[f.key] || undefined}>
              <Field.Label for={`code-${f.key}`}>{t(f.label)}</Field.Label>
              <Textarea
                id={`code-${f.key}`}
                rows={f.rows}
                spellcheck={false}
                class="font-mono text-xs"
                value={f.key === 'css' || isDefault ? code[f.key] : (code.translations[lang]?.[f.key] ?? '')}
                placeholder={f.key !== 'css' && !isDefault ? code[f.key] : undefined}
                oninput={(e) => {
                  const v = (e.currentTarget as HTMLTextAreaElement).value;
                  if (f.key === 'css' || isDefault) code[f.key] = v;
                  else code.translations = { ...code.translations, [lang]: { ...code.translations[lang], [f.key]: v } };
                }}
                aria-invalid={!!errors[f.key]}
              />
              {#if errors[f.key]}<Field.Error>{errors[f.key]}</Field.Error>{:else}<Field.Description
                  >{t(f.hint)}</Field.Description
                >{/if}
              {#if warnings[f.key]}
                <Alert.Root class="border-amber-500/40 bg-amber-50 dark:bg-amber-950"
                  ><TriangleAlertIcon /><Alert.Title>{warnings[f.key]}</Alert.Title></Alert.Root
                >
              {/if}
            </Field.Field>
          {/each}
        </Field.Group>
      </div>
      <Sheet.Footer class="flex-row justify-end border-t">
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving}
          >{#if saving}<Spinner />{/if}{t('common.save')}</Button
        >
      </Sheet.Footer>
    </form>
  </Sheet.Content>
</Sheet.Root>
