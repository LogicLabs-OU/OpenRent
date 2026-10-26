<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
  import { h2 } from '../lib/ink.ts';

  /** Categories as lime tiles: the name at the bottom, an arrow at the top. */
  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const heading = $derived(String(section.settings.heading ?? ''));
</script>

{#if rt.shop.categories.length}
  <section class="mb-16 flex flex-col gap-8 md:mb-24">
    {#if heading}<h2 class={[h2, 'text-center']}>{heading}</h2>{/if}
    <ul class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {#each rt.shop.categories as c (c.id)}
        <li>
          <a
            class="group bg-primary text-primary-foreground hover:bg-card hover:text-card-foreground focus-visible:ring-primary/50 flex min-h-32 flex-col justify-between gap-6 rounded-2xl p-5 transition-colors outline-none focus-visible:ring-4 md:min-h-40"
            href={rt.url.category(c.slug)}
          >
            <ArrowUpRightIcon
              class="size-6 self-end transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
            <span class="ink-serif text-2xl leading-tight md:text-3xl">{c.name}</span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
