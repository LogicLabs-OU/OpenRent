<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import Availability from './Availability.svelte';
  import MoreLink from './MoreLink.svelte';
  import Placeholder from './Placeholder.svelte';

  /** A white card: the photo (or a beige placeholder), the name in the display sans and the price in bronze mono. */
  let { product, index = 0 }: { product: Product; index?: number } = $props();
  const rt = getRuntime();
  const price = $derived(product.variants.find((v) => v.price)?.price);
  const avail = $derived(
    product.variants.some((v) => v.available !== undefined)
      ? product.variants.reduce((a, v) => a + (v.available ?? 99), 0)
      : undefined,
  );
</script>

<a
  class="group ln-lift flex flex-col overflow-hidden rounded-xl bg-white outline-none focus-visible:ring-3 focus-visible:ring-[var(--ln-accent)]/50"
  href={rt.url.product(product.slug)}
  data-testid="product-card"
>
  <div class="m-2 mb-0 aspect-[4/3] overflow-hidden rounded-lg bg-[var(--ln-beige)]">
    {#if product.images[0]}<img
        class="size-full object-cover transition-transform duration-700 ease-[cubic-bezier(.19,1,.22,1)] group-hover:scale-[1.04]"
        src={product.images[0].url_sm ?? product.images[0].url}
        alt={product.images[0].alt ?? ''}
        loading="lazy"
      />{:else}<Placeholder name={product.name} {index} />{/if}
  </div>
  <div class="flex flex-1 flex-col gap-2 px-5 pt-4 pb-5">
    <span class="ln-display text-[1.375rem] leading-[1.15] tracking-[-0.01em]">{product.name}</span>
    <p class="ln-mono text-[0.8125rem] leading-snug text-[var(--ln-accent)]">
      {#if price}{price.description}{:else if product.bundle}{product.bundle.components
          .map((c) => `${c.quantity}× ${c.name}`)
          .join(' + ')}{/if}
    </p>
    <div class="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
      {#if avail !== undefined}<Availability count={avail} />{/if}
      <MoreLink label={rt.t('product.view')} class="ml-auto text-[0.9375rem] group-hover:underline" />
    </div>
  </div>
</a>
