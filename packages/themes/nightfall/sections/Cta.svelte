<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { cn } from '@openrent/ui/utils';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import Accent from '../snippets/Accent.svelte';
  import { big, body, h2, pill } from '../lib/nightfall.ts';
  import { reveal } from '../lib/motion.ts';

  /** A closing panel on a dotted grid with an indigo light rising from below, a big headline and two buttons. */
  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as {
      heading: string;
      text: string;
      button_label: string;
      button_link: string;
      second_label: string;
      second_link: string;
    },
  );
</script>

<section
  class="relative mb-16 overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0a12] px-6 py-20 text-center md:mb-24 md:py-28"
  data-section="cta"
>
  <div class="nf-dots absolute inset-0 [mask-image:radial-gradient(70%_80%_at_50%_100%,black,transparent)]" aria-hidden="true"></div>
  <div class="nf-glow nf-glow-accent -bottom-1/2 left-1/2 h-[90%] w-[80%] -translate-x-1/2 opacity-80" aria-hidden="true"></div>
  <div class="relative mx-auto flex max-w-3xl flex-col items-center gap-6" use:reveal>
    {#if s.heading}<h2 class={h2}><Accent text={s.heading} /></h2>{/if}
    {#if s.text}<p class={cn(body, 'max-w-xl text-pretty')}>{s.text}</p>{/if}
    <div class="mt-2 flex flex-wrap justify-center gap-3">
      {#if s.button_label}<Button class={big} href={s.button_link || rt.url.search?.() || rt.url.home()}
          >{s.button_label}</Button
        >{/if}
      {#if s.second_label && s.second_link}<Button class={pill} href={s.second_link}
          >{s.second_label}<ArrowRightIcon /></Button
        >{/if}
    </div>
  </div>
</section>
