<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader, StatusBadge } from '@openrent/ui/openrent';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { api, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';
  import { to } from '#lib/nav.ts';
  import RichTextEditor from '#lib/components/rich-text-editor.svelte';
  import LanguageTabs from '#lib/components/language-tabs.svelte';
  import ThemeSections from '#lib/components/theme-sections.svelte';
  import ThemeContentTranslations from '#lib/components/theme-content-translations.svelte';
  import { shopLocales } from '#lib/components/shop-locales.svelte.ts';

  /**
   * One storefront page: its title, address and text in every storefront language, whether shoppers
   * see it, its search engine texts, and sections for the live theme with a preview.
   */
  type Texts = { title: string; body: string; seo_title: string; seo_description: string };
  let p = $state<any | null>(null);
  let theme = $state<any | null>(null);
  let slug = $state('');
  let published = $state(false);
  let texts = $state<Record<string, Texts>>({});
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  function fill(r: any) {
    p = r;
    slug = r.slug;
    published = r.status === 'published';
    texts = Object.fromEntries(
      shopLocales.list.map((l, i) => {
        const own = i === 0 ? { title: r.title, body: r.body, seo_title: r.seo?.title, seo_description: r.seo?.description } : (r.translations?.[l] ?? {});
        return [l, { title: own.title ?? '', body: own.body ?? '', seo_title: own.seo_title ?? '', seo_description: own.seo_description ?? '' }];
      }),
    );
  }

  onMount(async () => {
    try {
      const [r, list] = await Promise.all([api.get(`/storefront_pages/${page.params.id}`), api.get('/themes'), shopLocales.load()]);
      const live = list.data.find((x: any) => x.live);
      if (live) theme = await api.get(`/themes/${live.id}`);
      fill(r);
    } catch (e) {
      notifyError(e);
    }
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!p) return;
    saving = true;
    errors = {};
    const [def, ...others] = shopLocales.list;
    const base = texts[def!]!;
    const body = {
      title: base.title,
      slug: slug.trim(),
      status: published ? 'published' : 'draft',
      body: base.body,
      seo: { title: base.seo_title.trim() || null, description: base.seo_description.trim() || null },
      translations: Object.fromEntries(others.map((l) => [l, { title: texts[l]!.title || null, body: texts[l]!.body || null, seo_title: texts[l]!.seo_title || null, seo_description: texts[l]!.seo_description || null }])),
    };
    try {
      fill(await api.patch(`/storefront_pages/${p.id}`, body));
      toast.success(t('common.saved'));
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  async function preview() {
    if (!theme) return;
    try {
      const url = new URL((await api.post(`/themes/${theme.id}/actions/preview`)).url);
      url.pathname = `/pages/${p.slug}`;
      window.open(url.href, '_blank', 'noopener');
    } catch (e) {
      notifyError(e);
    }
  }

  async function remove() {
    if (!(await confirmAction({ title: t('pages.delete_title', { title: p.title }), description: t('pages.delete_description'), confirmLabel: t('common.delete'), destructive: true }))) return;
    try {
      await api.del(`/storefront_pages/${p.id}`);
      toast.success(t('common.removed'));
      await goto(to('/pages'));
    } catch (e) {
      notifyError(e);
    }
  }

  // The default language's fields are the page's own; the others' are its translations.
  const errorFor = (l: string, isDefault: boolean, k: keyof Texts) =>
    isDefault ? errors[k === 'seo_title' ? 'seo.title' : k === 'seo_description' ? 'seo.description' : k] : errors[`translations.${l}.${k}`];
</script>

<svelte:head><title>{p?.title ?? t('nav.pages')} · OpenRent</title></svelte:head>
{#if !p}
  <Skeleton class="h-96" />
{:else}
  <PageHeader title={p.title} description={`/pages/${p.slug}`}>
    {#snippet actions()}
      <StatusBadge status={p.status} label={t(`pages.status.${p.status}` as any)} />
      {#if theme}<Button variant="outline" onclick={preview}><EyeIcon />{t('themes.preview')}</Button>{/if}
      <Button variant="ghost" onclick={remove}><Trash2Icon />{t('common.delete')}</Button>
    {/snippet}
  </PageHeader>

  <div class="flex flex-col gap-6">
    <form onsubmit={save}>
      <Card.Root class="max-w-4xl">
        <Card.Header>
          <Card.Title>{t('pages.content')}</Card.Title>
          <Card.Description>{t('pages.content_hint')}</Card.Description>
        </Card.Header>
        <Card.Content>
          <Field.Group>
            <Field.Field orientation="horizontal">
              <Switch id="page-published" bind:checked={published} />
              <Field.Content>
                <Field.Label for="page-published">{t('pages.published')}</Field.Label>
                <Field.Description>{t('pages.published_hint')}</Field.Description>
              </Field.Content>
            </Field.Field>
            <Field.Field data-invalid={!!errors.slug || undefined}>
              <Field.Label for="page-slug">{t('pages.address')}</Field.Label>
              <Input id="page-slug" class="font-mono" bind:value={slug} aria-invalid={!!errors.slug} />
              {#if errors.slug}<Field.Error>{errors.slug}</Field.Error>{:else}<Field.Description>{t('pages.address_hint')}</Field.Description>{/if}
            </Field.Field>
            <LanguageTabs locales={shopLocales.list}>
              {#snippet children(l, isDefault)}
                <Field.Group>
                  <Field.Field data-invalid={!!errorFor(l, isDefault, 'title') || undefined}>
                    <Field.Label for="page-title-{l}">{t('pages.page_title')}</Field.Label>
                    <Input id="page-title-{l}" lang={l} placeholder={isDefault ? '' : texts[shopLocales.default]?.title} bind:value={texts[l]!.title} aria-invalid={!!errorFor(l, isDefault, 'title')} />
                    {#if errorFor(l, isDefault, 'title')}<Field.Error>{errorFor(l, isDefault, 'title')}</Field.Error>{/if}
                  </Field.Field>
                  <Field.Field>
                    <Field.Label for="page-body-{l}">{t('pages.text')}</Field.Label>
                    <RichTextEditor id="page-body-{l}" lang={l} label={`${t('pages.text')} (${l})`} bind:value={texts[l]!.body} />
                  </Field.Field>
                  <Field.Field data-invalid={!!errorFor(l, isDefault, 'seo_title') || undefined}>
                    <Field.Label for="page-seo-t-{l}">{t('product.seo_title')}</Field.Label>
                    <Input id="page-seo-t-{l}" lang={l} maxlength={70} placeholder={texts[l]!.title} bind:value={texts[l]!.seo_title} aria-invalid={!!errorFor(l, isDefault, 'seo_title')} />
                    {#if errorFor(l, isDefault, 'seo_title')}<Field.Error>{errorFor(l, isDefault, 'seo_title')}</Field.Error>{/if}
                  </Field.Field>
                  <Field.Field data-invalid={!!errorFor(l, isDefault, 'seo_description') || undefined}>
                    <Field.Label for="page-seo-d-{l}">{t('product.seo_description')}</Field.Label>
                    <Textarea id="page-seo-d-{l}" lang={l} maxlength={160} bind:value={texts[l]!.seo_description} aria-invalid={!!errorFor(l, isDefault, 'seo_description')} />
                    {#if errorFor(l, isDefault, 'seo_description')}<Field.Error>{errorFor(l, isDefault, 'seo_description')}</Field.Error>{:else}<Field.Description>{t('product.seo_hint', { count: texts[l]!.seo_description.length })}</Field.Description>{/if}
                  </Field.Field>
                </Field.Group>
              {/snippet}
            </LanguageTabs>
          </Field.Group>
        </Card.Content>
        <Card.Footer class="mt-6"><Button type="submit" disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button></Card.Footer>
      </Card.Root>
    </form>

    {#if theme}
      <ThemeSections {theme} onsaved={() => undefined} page={{ id: p.id, slug: p.slug, sections: p.sections?.[theme.id] ?? [], onsaved: (r) => (p = r) }} />
      {#if shopLocales.others.length && (p.sections?.[theme.id]?.length ?? 0) > 0}
        <ThemeContentTranslations {theme} onsaved={() => undefined} page={{ id: p.id, sections: p.sections[theme.id], content: p.content_translations?.[theme.id] ?? {}, onsaved: (r) => (p = r) }} />
      {/if}
    {/if}
  </div>
{/if}
