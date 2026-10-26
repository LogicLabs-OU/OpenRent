<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import * as Alert from '@openrent/ui/alert';
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import ProductCard from '../snippets/ProductCard.svelte';

  let { section, products }: { section: SectionInstance; products: Product[] } = $props();
  const rt = getRuntime();
  const s = $derived(section.settings as { heading: string; category: string; limit: number });
  const categoryId = $derived(
    s.category ? rt.shop.categories.find((c) => c.slug === s.category || c.id === s.category)?.id : undefined,
  );
  const shown = $derived(
    (categoryId ? products.filter((p) => p.category_ids.includes(categoryId)) : products).slice(
      0,
      s.limit || 100,
    ),
  );
</script>

<section class="mb-10 flex flex-col gap-4">
  {#if s.heading}<h2 class="text-2xl font-semibold tracking-tight">{s.heading}</h2>{/if}
  {#if !rt.shop.dates.from}
    <Alert.Root>
      <CalendarDaysIcon />
      <Alert.Title>{rt.t('dates.hint')}</Alert.Title>
    </Alert.Root>
  {/if}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {#each shown as p (p.id)}<ProductCard product={p} />{/each}
  </div>
</section>
