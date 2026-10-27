<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';
  import LanguageTabs from './language-tabs.svelte';
  import { shopLocales } from './shop-locales.svelte.ts';

  /**
   * What search engines and shared links show for the storefront's home page, per storefront language,
   * and the picture shared when a page has none of its own (the logo when empty).
   */
  type Texts = { title: string; description: string };
  let texts = $state<Record<string, Texts> | null>(null);
  let image = $state('');
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  onMount(async () => {
    try {
      const [s] = await Promise.all([api.get('/tenant/settings'), shopLocales.load()]);
      const seo = s.seo ?? {};
      texts = Object.fromEntries(shopLocales.list.map((l, i) => [l, i === 0 ? { title: seo.title ?? '', description: seo.description ?? '' } : { title: seo.translations?.[l]?.title ?? '', description: seo.translations?.[l]?.description ?? '' }]));
      image = seo.image_url ?? '';
    } catch (e) {
      notifyError(e);
    }
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!texts) return;
    saving = true;
    errors = {};
    const [def, ...others] = shopLocales.list;
    const d = texts[def!]!;
    const translations = Object.fromEntries(others.map((l) => [l, { title: texts![l]!.title.trim() || null, description: texts![l]!.description.trim() || null }]));
    try {
      await api.patch('/tenant/settings', { seo: { title: d.title.trim() || null, description: d.description.trim() || null, image_url: image.trim() || null, translations } });
      toast.success(t('common.saved'));
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  // Errors for a language's fields: the default's are `seo.title`, the others' `seo.translations.<l>.title`.
  const errorFor = (l: string, isDefault: boolean, k: keyof Texts) => errors[isDefault ? `seo.${k}` : `seo.translations.${l}.${k}`];
</script>

<Card.Root class="mt-6" data-testid="seo-settings">
  <Card.Header>
    <Card.Title>{t('seo.title')}</Card.Title>
    <Card.Description>{t('seo.hint')}</Card.Description>
  </Card.Header>
  {#if !texts}
    <Card.Content><Skeleton class="h-40" /></Card.Content>
  {:else}
    <form onsubmit={save}>
      <Card.Content>
        <Field.Group>
          <LanguageTabs locales={shopLocales.list}>
            {#snippet children(l, isDefault)}
              <Field.Group>
                <Field.Field data-invalid={!!errorFor(l, isDefault, 'title') || undefined}>
                  <Field.Label for="seo-title-{l}">{t('product.seo_title')}</Field.Label>
                  <Input id="seo-title-{l}" maxlength={70} bind:value={texts![l]!.title} aria-invalid={!!errorFor(l, isDefault, 'title')} />
                  {#if errorFor(l, isDefault, 'title')}<Field.Error>{errorFor(l, isDefault, 'title')}</Field.Error>{:else}<Field.Description>{t('seo.title_hint')}</Field.Description>{/if}
                </Field.Field>
                <Field.Field data-invalid={!!errorFor(l, isDefault, 'description') || undefined}>
                  <Field.Label for="seo-description-{l}">{t('product.seo_description')}</Field.Label>
                  <Textarea id="seo-description-{l}" maxlength={160} bind:value={texts![l]!.description} aria-invalid={!!errorFor(l, isDefault, 'description')} />
                  {#if errorFor(l, isDefault, 'description')}<Field.Error>{errorFor(l, isDefault, 'description')}</Field.Error>{:else}<Field.Description>{t('product.seo_hint', { count: texts![l]!.description.length })}</Field.Description>{/if}
                </Field.Field>
              </Field.Group>
            {/snippet}
          </LanguageTabs>
          <Field.Field data-invalid={!!errors['seo.image_url'] || undefined}>
            <Field.Label for="seo-image">{t('seo.image')}</Field.Label>
            <Input id="seo-image" type="url" placeholder="https://" bind:value={image} aria-invalid={!!errors['seo.image_url']} />
            {#if errors['seo.image_url']}<Field.Error>{errors['seo.image_url']}</Field.Error>{:else}<Field.Description>{t('seo.image_hint')}</Field.Description>{/if}
          </Field.Field>
        </Field.Group>
      </Card.Content>
      <Card.Footer class="mt-6"><Button type="submit" disabled={saving}>{t('common.save')}</Button></Card.Footer>
    </form>
  {/if}
</Card.Root>
