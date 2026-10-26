<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import { Badge } from '@openrent/ui/badge';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleXIcon from '@lucide/svelte/icons/circle-x';

  let { product }: { product: Product } = $props();
  const rt = getRuntime();
  const price = $derived(product.variants.find((v) => v.price)?.price);
  const avail = $derived(product.variants.some((v) => v.available !== undefined) ? product.variants.reduce((a, v) => a + (v.available ?? 99), 0) : undefined);
</script>

<a class="group focus-visible:ring-ring/50 rounded-xl outline-none focus-visible:ring-3" href={rt.url.product(product.slug)} data-testid="product-card">
  <Card.Root class="h-full pt-0 transition-shadow group-hover:shadow-md">
    <div class="from-primary/80 to-primary/30 text-primary-foreground flex aspect-[4/3] items-center justify-center bg-gradient-to-br text-5xl font-semibold">
      {#if product.images[0]}<img class="size-full object-cover" src={product.images[0].url_sm ?? product.images[0].url} alt={product.images[0].alt ?? ''} loading="lazy" />{:else}<span aria-hidden="true">{product.name[0]}</span>{/if}
    </div>
    <Card.Header>
      <Card.Title class="text-base">{product.name}</Card.Title>
      <Card.Description>
        {#if price}{price.description}{:else if product.bundle}{product.bundle.components.map((c) => `${c.quantity}× ${c.name}`).join(' + ')}{/if}
      </Card.Description>
    </Card.Header>
    {#if avail !== undefined}
      <Card.Footer class="mt-auto">
        {#if avail > 0}
          <Badge variant="outline" class="border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" data-availability="ok"><CircleCheckIcon />{rt.t('product.available', { count: avail })}</Badge>
        {:else}
          <Badge variant="outline" class="border-destructive/30 bg-destructive/10 text-destructive" data-availability="none"><CircleXIcon />{rt.t('product.unavailable')}</Badge>
        {/if}
      </Card.Footer>
    {/if}
  </Card.Root>
</a>
