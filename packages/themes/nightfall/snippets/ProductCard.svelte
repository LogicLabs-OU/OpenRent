<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
  import Availability from './Availability.svelte';
  import ProductArt from './ProductArt.svelte';

  /** Dark glass with an inner rounded picture, the name in white and the price at white/60. */
  let { product }: { product: Product } = $props();
  const rt = getRuntime();
  const price = $derived(product.variants.find((v) => v.price)?.price);
  const avail = $derived(
    product.variants.some((v) => v.available !== undefined)
      ? product.variants.reduce((a, v) => a + (v.available ?? 99), 0)
      : undefined,
  );
</script>

<a
  class="nf-card nf-glass group flex h-full flex-col gap-4 rounded-3xl p-2.5 outline-none focus-visible:ring-4 focus-visible:ring-ring/60"
  href={rt.url.product(product.slug)}
  data-testid="product-card"
>
  <div class="aspect-[4/3] overflow-hidden rounded-[18px] bg-[#101014]">
    {#if product.images[0]}<img
        class="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        src={product.images[0].url_sm ?? product.images[0].url}
        alt={product.images[0].alt ?? ''}
        loading="lazy"
      />{:else}<ProductArt name={product.name} />{/if}
  </div>
  <div class="flex flex-1 flex-col gap-1.5 px-2.5 pb-3">
    <div class="flex items-start justify-between gap-3">
      <span class="text-lg leading-snug font-semibold tracking-[-0.01em]">{product.name}</span>
      <span
        class="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors group-hover:border-white/25 group-hover:text-white"
        ><ArrowUpRightIcon class="size-4" aria-hidden="true" /></span
      >
    </div>
    <p class="line-clamp-2 text-sm leading-relaxed text-white/60">
      {#if price}{price.description}{:else if product.bundle}{product.bundle.components
          .map((c) => `${c.quantity}× ${c.name}`)
          .join(' + ')}{/if}
    </p>
    {#if avail !== undefined}<div class="mt-auto pt-2"><Availability count={avail} /></div>{/if}
  </div>
</a>
