<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import SearchIcon from '@lucide/svelte/icons/search';
  import { pad } from '../lib/marquee.ts';

  /**
   * Category chips like a venue's programme filter: each a bordered label with a count cell, the current one
   * solid blue, then a search chip with a magnifier cell. Counts are shown where the page knows them.
   * Sticks under the header while the grid scrolls; on phones the row scrolls sideways.
   */
  let {
    active = 'all',
    counts = {},
    total,
  }: { active?: string; counts?: Record<string, number>; total?: number } = $props();
  const rt = getRuntime();
  const all = $derived(rt.url.search?.() ?? rt.url.home());
</script>

<div class="sticky top-(--mq-head) z-20 -mx-4 bg-(--mq-paper) px-4 py-3 md:-mx-10 md:px-10">
  <div class="flex flex-nowrap items-start gap-2.5 overflow-x-auto md:flex-wrap md:overflow-visible">
    <nav class="contents" aria-label={rt.t('nav.categories')}>
      <a class="mq-chip shrink-0" href={all} aria-current={active === 'all' ? 'true' : undefined}
        ><span>{rt.t('chips.all')}</span>{#if total !== undefined}<span class="mq-mono text-[0.9375rem] font-normal"
            >{pad(total)}</span
          >{/if}</a
      >
      {#each rt.shop.categories as c (c.id)}
        <a
          class="mq-chip shrink-0"
          href={rt.url.category(c.slug)}
          aria-current={active === c.id ? 'page' : undefined}
          ><span>{c.name}</span>{#if counts[c.id] !== undefined}<span
              class="mq-mono text-[0.9375rem] font-normal">{pad(counts[c.id]!)}</span
            >{/if}</a
        >
      {/each}
    </nav>
    {#if rt.url.search}
      <form class="mq-chip shrink-0 hover:bg-(--mq-paper) hover:text-(--mq-ink)" method="GET" action={rt.url.search()} role="search">
        <input
          class="w-44 bg-transparent px-3 uppercase placeholder:text-(--mq-ink) md:w-56"
          name="q"
          type="search"
          placeholder={rt.t('chips.search')}
          aria-label={rt.t('search.label')}
        />
        <button class="grid w-11 place-items-center px-0! hover:bg-(--mq-ink) hover:text-(--mq-paper)" type="submit" aria-label={rt.t('search.submit')}
          ><SearchIcon class="size-4" aria-hidden="true" /></button
        >
      </form>
    {/if}
  </div>
</div>
