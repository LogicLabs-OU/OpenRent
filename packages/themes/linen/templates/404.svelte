<script lang="ts">
  import { getRuntime, type NotFoundData } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import Headline from '../snippets/Headline.svelte';
  import { btn, btnLine, display, lead } from '../lib/linen.ts';

  let { data }: { data: NotFoundData } = $props();
  const rt = getRuntime();
</script>

<section class="grid items-center gap-10 py-6 md:py-12 lg:grid-cols-[1.1fr_1fr]">
  <div class="flex flex-col items-start gap-7">
    <p class="ln-mono flex items-center gap-2.5 text-sm text-[var(--ln-accent)]">
      <span class="ln-square size-2" aria-hidden="true"></span><!-- i18n-ignore -->404
    </p>
    <Headline tag="h1" text={rt.t('404.title')} class={display} />
    <p class={[lead, 'max-w-md break-words']}>{rt.t('404.description', { path: data.path })}</p>
    <div class="flex flex-wrap gap-3">
      <Button class={btn} href={rt.url.home()}>{rt.t('nav.all')}</Button>
      {#if rt.url.search}<Button variant="outline" class={btnLine} href={rt.url.search()}
          >{rt.t('search.title')}</Button
        >{/if}
    </div>
  </div>
  <div class="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[20px] bg-[var(--ln-beige)]" aria-hidden="true">
    <span class="ln-display text-[9rem] leading-none tracking-[-0.06em] text-[#202020]/10 md:text-[14rem]"
      ><!-- i18n-ignore -->404</span
    >
    <svg class="absolute inset-x-[12%] bottom-[18%] h-auto w-[76%] text-[#202020]/25" viewBox="0 0 300 80" fill="none"
      ><path d="M2 60c40 0 46-44 86-44s44 56 84 56 46-60 126-60" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 6" /><circle
        cx="298"
        cy="12"
        r="5"
        fill="var(--ln-signal)"
      /></svg
    >
  </div>
</section>
