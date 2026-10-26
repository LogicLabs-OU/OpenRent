<svelte:options customElement={{ tag: 'openrent-book-button', shadow: 'open', props: { storefront: { type: 'String' }, product: { type: 'String' }, label: { type: 'String' }, lang: { type: 'String' } } }} />

<script lang="ts">
  import { Button } from '@openrent/ui/button';
  import { css, registerProperties } from './styles.ts';
  import { t, widgetLocale } from './i18n/index.ts';

  let { storefront = '', product = '', label = '', lang = '' }: { storefront?: string; product?: string; label?: string; lang?: string } = $props();
  registerProperties();
  const href = $derived(`${storefront.replace(/\/$/, '')}${product ? `/p/${encodeURIComponent(product)}` : '/'}`);
</script>

{@html css}
<Button part="button" size="lg" {href}>{label || t('book', {}, widgetLocale(lang))}</Button>
