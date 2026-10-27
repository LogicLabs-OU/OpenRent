<script lang="ts">
  import Head from '#lib/Head.svelte';
  import { formatter } from '#lib/format.ts';
  import { translator } from '#lib/text.ts';

  let { data } = $props();
  const t = $derived(translator(data.shop.lang));
  const f = $derived(formatter(data.shop.lang, data.shop.timezone));
</script>

<Head title={data.shop.seo.title ?? data.shop.name} description={data.shop.seo.description} image={data.shop.seo.image ?? data.products[0]?.images[0]?.url} />

<h1>{t('home.title', { shop: data.shop.name })}</h1>
{#if data.dates}<p class="muted">{t('cart.period', { from: f.when(data.dates.from), to: f.when(data.dates.to) })}</p>{/if}
{#if !data.products.length}
  <p class="muted">{t('home.empty')}</p>
{:else}
  <ul class="grid">
    {#each data.products as p (p.id)}
      {@const v = p.variants[0]}
      <li class="card">
        <a href={`/p/${p.slug}`}>
          {#if p.images[0]}<img src={p.images[0].url_sm ?? p.images[0].url} alt={p.images[0].alt ?? p.name} loading="lazy" />{/if}
          <h2>{p.name}</h2>
        </a>
        {#if v?.price}<p>{v.price.description}</p>{/if}
        {#if data.dates && v?.available != null}<p class="muted">{v.available > 0 ? t('product.available', { count: v.available }) : t('product.unavailable')}</p>{/if}
      </li>
    {/each}
  </ul>
{/if}
