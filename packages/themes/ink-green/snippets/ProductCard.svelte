<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import Availability from './Availability.svelte';

  /** A sage panel: the photo with rounded corners, the name in the serif, the price and what is free. */
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
  class="group ink-light bg-card text-card-foreground focus-visible:ring-primary/60 flex flex-col gap-4 rounded-2xl p-3 outline-none focus-visible:ring-4"
  href={rt.url.product(product.slug)}
  data-testid="product-card"
>
  <div class="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-[#2a6f2b]">
    {#if product.images[0]}<img
        class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        src={product.images[0].url_sm ?? product.images[0].url}
        alt={product.images[0].alt ?? ''}
        loading="lazy"
      />{:else}<span class="ink-serif text-7xl text-[#c8f169]" aria-hidden="true">{product.name[0]}</span
      >{/if}
  </div>
  <div class="flex flex-1 flex-col gap-2 px-2 pb-2">
    <div class="flex items-start justify-between gap-3">
      <span class="ink-serif text-2xl leading-tight">{product.name}</span>
      <ArrowRightIcon
        class="mt-1.5 size-5 shrink-0 transition-transform group-hover:translate-x-1"
        aria-hidden="true"
      />
    </div>
    <p class="text-muted-foreground text-sm">
      {#if price}{price.description}{:else if product.bundle}{product.bundle.components
          .map((c) => `${c.quantity}× ${c.name}`)
          .join(' + ')}{/if}
    </p>
    {#if avail !== undefined}<div class="mt-auto pt-1"><Availability count={avail} /></div>{/if}
  </div>
</a>
