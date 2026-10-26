<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import Coin from '../snippets/Coin.svelte';
  import { display, wrap } from '../lib/retro.ts';

  /** Four steps around a racetrack: left to right along the top, then back along the bottom. */
  let { heading, steps }: { heading: string; steps: string[] } = $props();
  const rt = getRuntime();
  const letter = $derived(rt.shop.tenant.name.trim()[0]?.toUpperCase() ?? '');
  const label = 'absolute -translate-y-1/2 bg-(--retro-highlight) px-4 text-lg whitespace-nowrap md:text-2xl';
  const arrow = 'absolute size-7 -translate-y-1/2 bg-(--retro-highlight)';
</script>

<section class={[wrap, 'flex flex-col items-center gap-12 py-20 md:py-28']}>
  <h2 class={[display, 'text-center']}>{heading}</h2>
  <!-- Wide screens: the racetrack. -->
  <div
    class="relative hidden h-80 w-full rounded-full border border-black bg-(--retro-highlight) text-(--retro-highlight-ink) md:block"
    role="img"
    aria-label={steps.join(', ')}
  >
    <div class="absolute inset-8 rounded-full border border-black">
      <ChevronRightIcon class={`${arrow} top-0 left-[14%]`} strokeWidth={1.5} />
      <span class={[label, 'top-0 left-[20%]']}>{steps[0]}</span>
      <ChevronRightIcon class={`${arrow} top-0 left-[58%]`} strokeWidth={1.5} />
      <span class={[label, 'top-0 left-[64%]']}>{steps[1]}</span>
      <ChevronLeftIcon class={`${arrow} top-full right-[14%]`} strokeWidth={1.5} />
      <span class={[label, 'top-full right-[20%]']}>{steps[2]}</span>
      <ChevronLeftIcon class={`${arrow} top-full right-[58%]`} strokeWidth={1.5} />
      <span class={[label, 'top-full right-[64%]']}>{steps[3]}</span>
    </div>
    <Coin {letter} class="absolute top-1/2 left-1/2 w-40 -translate-x-1/2 -translate-y-1/2 -rotate-12" />
  </div>
  <!-- Small screens: the same steps as a list. -->
  <ol
    class="flex w-full flex-col items-center gap-2 rounded-[2rem] border border-black bg-(--retro-highlight) px-6 py-8 text-xl text-(--retro-highlight-ink) md:hidden"
  >
    {#each steps as s, i (i)}
      <li class="flex flex-col items-center gap-2">
        {s}
        {#if i < steps.length - 1}<ChevronDownIcon class="size-6" strokeWidth={1.5} aria-hidden="true" />{/if}
      </li>
    {/each}
  </ol>
</section>
