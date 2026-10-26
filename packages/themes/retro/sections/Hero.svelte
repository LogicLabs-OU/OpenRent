<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import Coin from '../snippets/Coin.svelte';
  import DateBar from '../snippets/DateBar.svelte';
  import { wrap } from '../lib/retro.ts';

  let { heading, text, coins }: { heading: string; text: string; coins: boolean } = $props();
  const rt = getRuntime();
  const letter = $derived(rt.shop.tenant.name.trim()[0]?.toUpperCase() ?? '');
  const loc = $derived(rt.shop.locations[0]);
</script>

<section class="relative overflow-hidden border-b border-black">
  {#if coins}
    <Coin {letter} class="absolute top-10 -left-6 w-28 -rotate-[28deg] md:top-20 md:left-10 md:w-44" />
    <Coin {letter} class="absolute top-6 -right-8 w-24 rotate-[18deg] md:top-6 md:right-20 md:w-32" />
    <Coin {letter} class="absolute bottom-6 -left-16 hidden w-56 rotate-[8deg] md:block lg:-left-10" />
    <Coin {letter} class="absolute -right-10 bottom-24 hidden w-44 rotate-[52deg] md:block" />
    <Coin {letter} class="absolute right-[18%] -bottom-8 hidden w-40 -rotate-[62deg] lg:block" />
  {/if}
  <div class={[wrap, 'relative flex flex-col items-center gap-6 py-20 text-center md:gap-8 md:py-32']}>
    <h1
      class="max-w-4xl text-5xl leading-[1.02] font-normal tracking-tight text-balance md:text-7xl lg:text-[5.5rem]"
    >
      {heading}
    </h1>
    {#if text}<p class="max-w-2xl text-lg text-pretty md:text-2xl">{text}</p>{/if}
    <div class="mt-2 w-full max-w-4xl"><DateBar variant="panel" /></div>
    {#if loc}<p class="text-muted-foreground text-sm">
        {rt.t('hero.pickup_at', { place: [loc.name, loc.address?.city].filter(Boolean).join(', ') })}
      </p>{/if}
  </div>
</section>
