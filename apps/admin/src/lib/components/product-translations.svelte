<script lang="ts">
  import RichTextEditor from './rich-text-editor.svelte';
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Tabs from '@openrent/ui/tabs';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { api, t, toast, notifyError } from '#lib';
  import { to } from '#lib/nav.ts';
  import { shopLocales } from './shop-locales.svelte.ts';

  /**
   * Product texts in the shop's other storefront languages: name, description, variant names and
   * photo descriptions. Empty fields show the default-language text to customers.
   */
  let { product, images = [], onsaved }: { product: any; images?: any[]; onsaved: () => void } = $props();
  let tab = $state('');
  let draft = $state<Record<string, { name: string; description: string; variants: Record<string, string>; alts: Record<string, string> }>>({});
  let saving = $state(false);

  function reset() {
    draft = Object.fromEntries(
      shopLocales.others.map((l) => [
        l,
        {
          name: product.translations?.[l]?.name ?? '',
          description: product.translations?.[l]?.description ?? '',
          variants: Object.fromEntries(product.variants.map((v: any) => [v.id, v.translations?.[l]?.name ?? ''])),
          alts: Object.fromEntries(images.map((i: any) => [i.id, i.alt?.[l] ?? ''])),
        },
      ]),
    );
    tab ||= shopLocales.others[0] ?? '';
  }
  onMount(() => {
    shopLocales.load().then(reset, notifyError);
  });

  const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim()));

  async function save() {
    saving = true;
    try {
      const translations = { ...(product.translations ?? {}) };
      for (const [l, d] of Object.entries(draft)) translations[l] = clean({ name: d.name, description: d.description });
      await api.patch(`/products/${product.id}`, { translations });
      for (const v of product.variants) {
        const next = { ...(v.translations ?? {}) };
        for (const [l, d] of Object.entries(draft)) next[l] = clean({ name: d.variants[v.id] ?? '' });
        if (JSON.stringify(next) !== JSON.stringify(v.translations ?? {})) await api.patch(`/variants/${v.id}`, { translations: next });
      }
      for (const img of images) {
        const alt = { ...(img.alt ?? {}) };
        for (const [l, d] of Object.entries(draft)) {
          if (d.alts[img.id]?.trim()) alt[l] = d.alts[img.id]!.trim();
          else delete alt[l];
        }
        if (JSON.stringify(alt) !== JSON.stringify(img.alt ?? {})) await api.patch(`/products/${product.id}/images/${img.id}`, { alt });
      }
      toast.success(t('translations.saved'));
      onsaved();
    } catch (e) {
      notifyError(e);
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root data-testid="product-translations">
  <Card.Header>
    <Card.Title>{t('translations.title')}</Card.Title>
    <Card.Description>{t('translations.product_hint', { language: t(`language.${shopLocales.default}` as any) })}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if !shopLocales.loaded}
      <Spinner />
    {:else if !shopLocales.others.length}
      <p class="text-muted-foreground text-sm">{t('translations.none')} <a class="underline underline-offset-4" href={to('/settings')}>{t('translations.none_link')}</a></p>
    {:else}
      <Tabs.Root bind:value={tab}>
        <Tabs.List>{#each shopLocales.others as l (l)}<Tabs.Trigger value={l} lang={l}>{LOCALE_NAMES[l as Locale] ?? l}</Tabs.Trigger>{/each}</Tabs.List>
        {#each shopLocales.others as l (l)}
          {#if draft[l]}
            <Tabs.Content value={l} class="pt-2">
              <Field.Group>
                <Field.Field>
                  <Field.Label for={`tr-name-${l}`}>{t('field.name')}</Field.Label>
                  <Input id={`tr-name-${l}`} lang={l} placeholder={product.name} bind:value={draft[l].name} />
                </Field.Field>
                <Field.Field>
                  <Field.Label for={`tr-desc-${l}`}>{t('field.description')}</Field.Label>
                  <RichTextEditor id={`tr-desc-${l}`} lang={l} label={`${t('field.description')} (${l})`} bind:value={draft[l].description} />
                </Field.Field>
                {#if product.variants.length > 1}
                  <Field.Set>
                    <Field.Legend variant="label">{t('translations.variant_names')}</Field.Legend>
                    {#each product.variants as v (v.id)}
                      <Field.Field orientation="horizontal">
                        <Field.Label for={`tr-v-${l}-${v.id}`} class="w-40 shrink-0 font-normal">{v.name}</Field.Label>
                        <Input id={`tr-v-${l}-${v.id}`} lang={l} placeholder={v.name} bind:value={draft[l].variants[v.id]} />
                      </Field.Field>
                    {/each}
                  </Field.Set>
                {/if}
                {#if images.length}
                  <Field.Set>
                    <Field.Legend variant="label">{t('translations.photo_descriptions')}</Field.Legend>
                    {#each images as img (img.id)}
                      <Field.Field orientation="horizontal">
                        <img src={img.url_sm} alt="" class="size-10 shrink-0 rounded object-cover" />
                        <Input lang={l} aria-label={t('images.alt')} placeholder={img.alt?.[shopLocales.default] ?? ''} bind:value={draft[l].alts[img.id]} />
                      </Field.Field>
                    {/each}
                  </Field.Set>
                {/if}
              </Field.Group>
            </Tabs.Content>
          {/if}
        {/each}
      </Tabs.Root>
    {/if}
  </Card.Content>
  {#if shopLocales.others.length}
    <Card.Footer><Button onclick={save} disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button></Card.Footer>
  {/if}
</Card.Root>
