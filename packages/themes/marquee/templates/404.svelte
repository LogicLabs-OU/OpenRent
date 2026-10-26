<script lang="ts">
  import { getRuntime, type NotFoundData } from '@openrent/theme-sdk';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { h2 } from '../lib/marquee.ts';
  import { countUp } from '../lib/motion.ts';

  /** The intro's giant counter, stopped at 404, with the missing path in mono and a way back. */
  let { data }: { data: NotFoundData } = $props();
  const rt = getRuntime();
</script>

<div class="flex flex-col gap-10 py-4">
  <!-- i18n-ignore -->
  <p
    class="mq-tight text-[clamp(9rem,34vw,30rem)] leading-[0.78] font-extrabold [font-variant-numeric:tabular-nums]"
    aria-hidden="true"
    use:countUp={404}
  >
    404
  </p>
  <div class="grid gap-8 border-t border-(--mq-ink) pt-8 md:grid-cols-[1fr_auto] md:items-end">
    <div class="flex flex-col gap-4">
      <h1 class={h2}>{rt.t('404.title')}</h1>
      <p class="mq-mono text-sm break-all">{rt.t('404.description', { path: data.path })}</p>
    </div>
    <a
      class="mq-cta flex h-14 items-center justify-between gap-6 px-6 text-[1.375rem] font-bold uppercase"
      href={rt.url.home()}>{rt.t('nav.home')}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></a
    >
  </div>
</div>
