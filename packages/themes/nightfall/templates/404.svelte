<script lang="ts">
  import { getRuntime, type NotFoundData } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { cn } from '@openrent/ui/utils';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { h1, pill } from '../lib/nightfall.ts';

  let { data }: { data: NotFoundData } = $props();
  const rt = getRuntime();
</script>

<div class="relative flex flex-col items-center gap-6 py-16 text-center md:py-24">
  <div class="nf-glow nf-glow-warm top-0 left-1/2 h-96 w-[min(900px,120vw)] -translate-x-1/2 opacity-60" aria-hidden="true"></div>
  <!-- i18n-ignore -->
  <p
    class="relative bg-gradient-to-b from-white to-white/10 bg-clip-text text-[8rem] leading-none font-semibold tracking-[-0.06em] text-transparent md:text-[14rem]"
    aria-hidden="true"
  >
    404
  </p>
  <h1 class={cn(h1, 'relative')}>{rt.t('404.title')}</h1>
  <p class="relative max-w-md break-words text-white/70">{rt.t('404.description', { path: data.path })}</p>
  <div class="relative mt-2 flex flex-wrap justify-center gap-3">
    <Button class="h-12 rounded-full px-6" href={rt.url.home()}>{rt.t('nav.all')}</Button>
    {#if rt.url.search}<Button class={pill} href={rt.url.search()}>{rt.t('search.title')}<ArrowRightIcon /></Button>{/if}
  </div>
</div>
