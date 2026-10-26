<svelte:options
  customElement={{
    tag: 'openrent-category',
    shadow: 'open',
    props: { category: { type: 'String' }, shop: { type: 'String' }, pk: { type: 'String' }, api: { type: 'String' }, storefront: { type: 'String' }, lang: { type: 'String' }, limit: { type: 'Number' }, checkout: { type: 'String' } },
  }}
/>

<script lang="ts">
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { call, config, openCheckout } from './api.ts';
  import { css, registerProperties } from './styles.ts';
  import { t } from './i18n/index.ts';

  /** A category's products as cards; "Book" opens the checkout drawer, or the storefront with checkout="storefront". */
  let { category = '', shop = '', pk = '', api = '', storefront = '', lang = '', limit = 12, checkout = 'inline' }: { category?: string; shop?: string; pk?: string; api?: string; storefront?: string; lang?: string; limit?: number; checkout?: string } = $props();
  registerProperties();
  const cfg = $derived(config({ api, shop, pk, storefront, lang }));
  let products = $state<any[] | null>(null);
  let error = $state('');
  let opening = $state('');

  $effect(() => {
    if (!cfg.api) return;
    const q = new URLSearchParams({ locale: cfg.locale, limit: String(Math.min(Math.max(1, limit), 100)), ...(category ? { category } : {}) });
    call(cfg, `/catalog/products?${q}`).then((r) => (products = r.data), (e) => (error = e.message));
  });

  async function book(p: any) {
    if (checkout === 'storefront') {
      location.href = `${cfg.storefront!.replace(/\/$/, '')}/p/${encodeURIComponent(p.slug)}`;
      return;
    }
    opening = p.slug;
    try {
      await openCheckout({ product: p.slug, shop, pk, api: cfg.api, storefront: cfg.storefront, lang: cfg.locale });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      opening = '';
    }
  }
</script>

{@html css}
<div class="text-foreground grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4 text-sm" part="grid">
  {#if products}
    {#each products as p (p.id)}
      <div class="bg-card text-card-foreground ring-foreground/10 flex flex-col overflow-hidden rounded-xl shadow-xs ring-1" part="card" data-product={p.slug}>
        {#if p.images?.[0]}<img src={p.images[0].url_sm ?? p.images[0].url} alt={p.images[0].alt ?? p.name} class="aspect-[4/3] w-full object-cover" loading="lazy" />{/if}
        <div class="flex flex-1 flex-col gap-1 p-4">
          <div class="font-semibold" part="title">{p.name}</div>
          {#if p.variants?.[0]?.price}<div class="text-muted-foreground">{p.variants[0].price.description}</div>{/if}
          <Button part="button" class="mt-auto w-full" disabled={opening === p.slug} onclick={() => book(p)}>{#if opening === p.slug}<Spinner />{/if}{t('book', {}, cfg.locale)}</Button>
        </div>
      </div>
    {:else}
      <p class="text-muted-foreground">{t('category_empty', {}, cfg.locale)}</p>
    {/each}
  {:else if error}
    <p class="text-destructive" role="alert">{error}</p>
  {:else}
    <p class="text-muted-foreground flex items-center gap-2"><Spinner />{t('loading', {}, cfg.locale)}</p>
  {/if}
</div>
