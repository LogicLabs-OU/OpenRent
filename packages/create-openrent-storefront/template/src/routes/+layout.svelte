<script lang="ts">
  import '../app.css';
  import { translator } from '#lib/text.ts';

  let { data, children } = $props();
  const t = $derived(translator(data.shop.lang));
</script>

<header>
  <a href="/" class="brand">
    {#if data.shop.logo}<img src={data.shop.logo} alt={data.shop.name} height="32" />{:else}<strong>{data.shop.name}</strong>{/if}
  </a>
  <nav>
    <a href="/">{t('nav.catalogue')}</a>
    <a href="/cart">{t('nav.cart', { count: data.cartCount })}</a>
  </nav>
</header>
<main>
  {@render children()}
</main>
<footer>{t('footer')}</footer>
