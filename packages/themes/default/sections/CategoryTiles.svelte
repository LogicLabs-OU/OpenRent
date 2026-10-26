<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';

  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const heading = $derived(String(section.settings.heading ?? ''));
</script>

{#if rt.shop.categories.length}
  <section class="mb-6 flex flex-col gap-3">
    {#if heading}<h2 class="text-xl font-semibold">{heading}</h2>{/if}
    <div class="flex flex-wrap gap-2">
      {#each rt.shop.categories as c (c.id)}<Button
          variant="outline"
          size="sm"
          class="rounded-full"
          href={rt.url.category(c.slug)}>{c.name}</Button
        >{/each}
    </div>
  </section>
{/if}
