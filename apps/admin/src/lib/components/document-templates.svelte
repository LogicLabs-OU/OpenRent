<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Table from '@openrent/ui/table';
  import * as Collapsible from '@openrent/ui/collapsible';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Textarea } from '@openrent/ui/textarea';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { shopLocales } from './shop-locales.svelte.ts';
  import { api, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';

  /**
   * Settings → Documents (FR-DOC-2): each document type per storefront language, edited as Handlebars
   * with a live preview against a real order. Issued documents never change.
   */
  let locale = $state('');
  let templates = $state<any[]>([]);
  let editing = $state<any>(null);
  let draft = $state({ body: '', css: '' });
  let errors = $state<Record<string, string>>({});
  let preview = $state('');
  let orderRef = $state('');
  let variables = $state<{ values: string[]; helpers: string[] } | null>(null);
  let saving = $state(false);

  async function load() {
    await shopLocales.load();
    if (!locale) locale = shopLocales.default;
    templates = (await api.get(`/document_templates?locale=${locale}`)).data;
  }
  onMount(() => {
    load().catch(notifyError);
    api.get('/document_templates/variables').then((v) => (variables = v), notifyError);
  });

  async function edit(tpl: any) {
    editing = tpl;
    draft = { body: tpl.body, css: tpl.css ?? '' };
    errors = {};
    preview = '';
    await renderPreview();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Re-renders shortly after typing stops. */
  function changed() {
    clearTimeout(timer);
    timer = setTimeout(() => renderPreview().catch(() => undefined), 600);
  }

  async function renderPreview() {
    if (!editing) return;
    try {
      const order = orderRef.trim() ? (await api.get(`/orders/${encodeURIComponent(orderRef.trim())}`)).id : undefined;
      preview = await api.post('/document_templates/preview', { type: editing.type, body: draft.body, css: draft.css, locale, ...(order ? { order_id: order } : {}) });
      errors = {};
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    }
  }

  async function save() {
    saving = true;
    errors = {};
    try {
      await api.post('/document_templates', { type: editing.type, locale, body: draft.body, css: draft.css });
      toast.success(t('documents.template_saved'));
      editing = null;
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  async function reset(tpl: any) {
    if (!(await confirmAction({ title: t('documents.reset_title', { name: tpl.name }), description: t('documents.reset_description'), confirmLabel: t('documents.reset') }))) return;
    try {
      await api.del(`/document_templates/${tpl.id}`);
      toast.success(t('documents.reset_done'));
      await load();
    } catch (err) {
      notifyError(err);
    }
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{t('documents.templates_title')}</Card.Title>
    <Card.Description>{t('documents.templates_hint')}</Card.Description>
    {#if shopLocales.list.length > 1}
      <Card.Action>
        <NativeSelect value={locale} onchange={(e) => { locale = (e.currentTarget as HTMLSelectElement).value; load().catch(notifyError); }} aria-label={t('language.label')} data-testid="document-language">
          {#each shopLocales.list as l (l)}<NativeSelectOption value={l}>{LOCALE_NAMES[l as Locale] ?? l}</NativeSelectOption>{/each}
        </NativeSelect>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content>
    <Table.Root>
      <Table.Body>
        {#each templates as tpl (tpl.type)}
          <Table.Row data-testid="document-template-row">
            <Table.Cell class="font-medium">{tpl.name}</Table.Cell>
            <Table.Cell>{#if tpl.builtin}<Badge variant="secondary">{t('documents.builtin')}</Badge>{:else}<Badge>{t('documents.customised')}</Badge>{/if}</Table.Cell>
            <Table.Cell class="text-right whitespace-nowrap">
              {#if !tpl.builtin}<Button size="sm" variant="ghost" onclick={() => reset(tpl)}><RotateCcwIcon />{t('documents.reset')}</Button>{/if}
              <Button size="sm" variant="ghost" onclick={() => edit(tpl)}><PencilIcon />{t('common.edit')}</Button>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </Card.Content>
</Card.Root>

<Sheet.Root open={!!editing} onOpenChange={(o) => !o && (editing = null)}>
  <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-5xl">
    {#if editing}
      <Sheet.Header>
        <Sheet.Title>{editing.name}{shopLocales.list.length > 1 ? ` · ${LOCALE_NAMES[locale as Locale] ?? locale}` : ''}</Sheet.Title>
        <Sheet.Description>{t('documents.editor_hint')}</Sheet.Description>
      </Sheet.Header>
      <div class="grid gap-6 px-4 lg:grid-cols-2">
        <Field.Group>
          <Field.Field data-invalid={!!errors.body || undefined}>
            <Field.Label for="dt-body">{t('documents.template_body')}</Field.Label>
            <Textarea id="dt-body" class="min-h-96 font-mono text-xs" spellcheck={false} bind:value={draft.body} oninput={changed} aria-invalid={!!errors.body} />
            {#if errors.body}<Field.Error>{errors.body}</Field.Error>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="dt-css">{t('documents.template_css')}</Field.Label>
            <Textarea id="dt-css" class="min-h-24 font-mono text-xs" spellcheck={false} bind:value={draft.css} oninput={changed} />
          </Field.Field>
          {#if variables}
            <Collapsible.Root>
              <Collapsible.Trigger>{#snippet child({ props })}<Button variant="link" class="px-0" {...props}>{t('documents.variables')}</Button>{/snippet}</Collapsible.Trigger>
              <Collapsible.Content>
                <div class="text-muted-foreground flex flex-wrap gap-1 font-mono text-xs">
                  {#each [...variables.values.map((v) => `{{${v}}}`), ...variables.helpers] as v (v)}<code class="bg-muted rounded px-1">{v}</code>{/each}
                </div>
              </Collapsible.Content>
            </Collapsible.Root>
          {/if}
        </Field.Group>
        <div class="flex flex-col gap-2">
          <div class="flex items-end gap-2">
            <Field.Field class="flex-1">
              <Field.Label for="dt-order">{t('documents.preview_order')}</Field.Label>
              <Input id="dt-order" placeholder={t('documents.preview_order_hint')} bind:value={orderRef} />
            </Field.Field>
            <Button variant="outline" onclick={() => renderPreview()}><EyeIcon />{t('email.refresh_preview')}</Button>
          </div>
          {#if preview}<iframe title={t('email.preview')} sandbox="" class="h-[36rem] w-full rounded-md border bg-white" srcdoc={preview} data-testid="document-preview"></iframe>{/if}
        </div>
      </div>
      <Sheet.Footer class="flex-row flex-wrap">
        <Button onclick={save} disabled={saving}>{t('common.save')}</Button>
        <Sheet.Close>{#snippet child({ props })}<Button variant="ghost" {...props}>{t('common.cancel')}</Button>{/snippet}</Sheet.Close>
      </Sheet.Footer>
    {/if}
  </Sheet.Content>
</Sheet.Root>
