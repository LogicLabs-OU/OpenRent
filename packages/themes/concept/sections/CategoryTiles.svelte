<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { categoryIcons, col, h2, row } from '../lib/concept.ts';

  /** Categories as links to sub-pages, in two columns. */
  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const heading = $derived(String(section.settings.heading ?? ''));
  const icons = $derived(categoryIcons(rt.shop.settings.category_icons));
</script>

{#if rt.shop.categories.length}
  <section class={[col, 'mb-8 flex flex-col gap-2']}>
    {#if heading}<h2 class={[h2, 'mb-1']}>{heading}</h2>{/if}
    <ul class="grid gap-x-6 gap-y-px sm:grid-cols-2">
      {#each rt.shop.categories as c (c.id)}
        <li>
          <a class={[row, 'flex items-center gap-2 px-1 py-1']} href={rt.url.category(c.slug)}>
            {#if icons[c.slug]}<span class="w-5 text-center text-lg leading-none" aria-hidden="true"
                >{icons[c.slug]}</span
              >{:else}<FileTextIcon class="text-muted-foreground size-5 shrink-0" />{/if}
            <span class="truncate border-b border-[rgba(55,53,47,0.2)] font-medium leading-tight"
              >{c.name}</span
            >
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
