<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { big, ghostLine, h2 } from '../lib/ink.ts';

  /** A closing lime band: the shop's initial as a giant letter, a heading and up to two buttons. */
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
  class="ink-light mb-16 grid items-center overflow-hidden rounded-2xl bg-[#c8f169] text-[#043f2e] md:mb-24 md:grid-cols-[auto_1fr]"
  data-section="cta"
>
  <span
    class="ink-serif hidden px-10 text-[16rem] leading-[0.8] font-semibold text-[#78c51c] select-none md:block lg:text-[20rem]"
    aria-hidden="true">{rt.shop.tenant.name.slice(0, 1).toUpperCase()}</span
  >
  <div class="flex flex-col items-start gap-5 p-8 md:p-12">
    {#if s.heading}<h2 class={h2}>{s.heading}</h2>{/if}
    {#if s.text}<p class="text-lg">{s.text}</p>{/if}
    <div class="flex flex-wrap gap-3">
      {#if s.button_label}<Button class={big} href={s.button_link || rt.url.search?.() || rt.url.home()}
          >{s.button_label}</Button
        >{/if}
      {#if s.second_label && s.second_link}<Button variant="outline" class={ghostLine} href={s.second_link}
          >{s.second_label}</Button
        >{/if}
    </div>
  </div>
</section>
