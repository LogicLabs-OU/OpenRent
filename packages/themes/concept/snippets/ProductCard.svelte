<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import Tag from './Tag.svelte';
  import Availability from './Availability.svelte';
  import { coverFor, tagFor } from '../lib/concept.ts';
  import { facts } from '../lib/products.ts';

  /** A gallery card: the photo as the card's cover, then the name and a few properties. */
  let { product }: { product: Product } = $props();
  const rt = getRuntime();
  const f = $derived(facts(product, rt.shop.categories));
</script>

<a
  class="group focus-visible:ring-ring/50 flex flex-col overflow-hidden rounded-[6px] bg-white shadow-[0_0_0_1px_rgba(15,15,15,0.08),0_2px_4px_rgba(15,15,15,0.06)] transition-[background-color,box-shadow] outline-none hover:bg-[#fbfbfa] hover:shadow-[0_0_0_1px_rgba(15,15,15,0.1),0_4px_10px_rgba(15,15,15,0.1)] focus-visible:ring-3"
  href={rt.url.product(product.slug)}
  data-testid="product-card"
>
  <div
    class="aspect-[16/10] overflow-hidden border-b border-[rgba(55,53,47,0.09)]"
    style:background={product.images[0] ? '#f8f7f5' : coverFor(product.slug)}
  >
    {#if product.images[0]}<img
        class="size-full object-cover"
        src={product.images[0].url_sm ?? product.images[0].url}
        alt={product.images[0].alt ?? ''}
        loading="lazy"
      />{/if}
  </div>
  <div class="flex flex-1 flex-col gap-1.5 px-2.5 pt-2 pb-2.5">
    <div class="truncate text-sm font-medium">{product.name}</div>
    {#if f.summary}<div class="text-muted-foreground truncate text-xs">{f.summary}</div>{/if}
    {#if f.cats.length || f.avail !== undefined}
      <div class="mt-auto flex flex-wrap gap-1 pt-0.5">
        <Availability count={f.avail} />
        {#each f.cats.slice(0, 2) as c (c.id)}<Tag color={tagFor(c.slug)}>{c.name}</Tag>{/each}
      </div>
    {/if}
  </div>
</a>
