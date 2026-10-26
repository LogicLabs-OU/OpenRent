<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleXIcon from '@lucide/svelte/icons/circle-x';
  import PriceTag from './PriceTag.svelte';
  import { lift } from '../lib/retro.ts';

  let { product }: { product: Product } = $props();
  const rt = getRuntime();
  const price = $derived(product.variants.find((v) => v.price)?.price);
  const avail = $derived(
    product.variants.some((v) => v.available !== undefined)
      ? product.variants.reduce((a, v) => a + (v.available ?? 99), 0)
      : undefined,
  );
  const image = $derived(product.images[0]);
</script>

<a
  class={[
    'group block h-full rounded-[0.25rem] outline-none focus-visible:ring-3 focus-visible:ring-black/40',
    lift,
  ]}
  href={rt.url.product(product.slug)}
  data-testid="product-card"
>
  <Card.Root class="h-full gap-0 py-0">
    <div
      class="flex aspect-square items-center justify-center overflow-hidden border-b border-black bg-(--retro-accent) text-7xl text-(--retro-accent-ink)"
    >
      {#if image}<img
          class="size-full object-cover"
          src={image.url_sm ?? image.url}
          alt={image.alt ?? ''}
          loading="lazy"
        />{:else}<span aria-hidden="true">{product.name[0]}</span>{/if}
    </div>
    <div class="flex flex-1 flex-col gap-2 p-3 sm:p-4">
      <h3 class="text-base leading-snug sm:text-lg">{product.name}</h3>
      {#if price}
        <p class="text-muted-foreground text-sm">{price.description}</p>
      {:else if product.bundle}
        <p class="text-muted-foreground text-sm">
          {product.bundle.components.map((c) => `${c.quantity}× ${c.name}`).join(' + ')}
        </p>
      {/if}
      {#if avail !== undefined}
        {#if avail > 0}
          <p class="mt-auto flex items-center gap-1.5 text-sm" data-availability="ok">
            <CircleCheckIcon class="size-4 text-[#23a094]" />{rt.t('product.available', { count: avail })}
          </p>
        {:else}
          <p class="text-destructive mt-auto flex items-center gap-1.5 text-sm" data-availability="none">
            <CircleXIcon class="size-4" />{rt.t('product.unavailable')}
          </p>
        {/if}
      {/if}
    </div>
    <!-- Tiered and table prices have no single amount; the description above carries them. -->
    {#if price?.amount.amount}
      <div class="border-t border-black p-3 sm:p-4"><PriceTag {price} /></div>
    {/if}
  </Card.Root>
</a>
