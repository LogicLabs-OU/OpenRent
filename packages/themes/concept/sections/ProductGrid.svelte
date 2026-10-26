<script lang="ts">
  import { getRuntime, type Product, type SectionInstance } from '@openrent/theme-sdk';
  import Callout from '../snippets/Callout.svelte';
  import Database from '../snippets/Database.svelte';
  import { col } from '../lib/concept.ts';

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

<section class={[col, 'mb-10 flex flex-col gap-4']}>
  {#if !rt.shop.dates.from}<Callout icon="📅">{rt.t('dates.hint')}</Callout>{/if}
  <Database products={shown} title={s.heading} />
</section>
