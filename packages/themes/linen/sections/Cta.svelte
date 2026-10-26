<script lang="ts">
  import { getRuntime, type SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import BikeIcon from '@lucide/svelte/icons/bike';
  import CameraIcon from '@lucide/svelte/icons/camera';
  import DrillIcon from '@lucide/svelte/icons/drill';
  import MicVocalIcon from '@lucide/svelte/icons/mic-vocal';
  import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
  import SailboatIcon from '@lucide/svelte/icons/sailboat';
  import SpeakerIcon from '@lucide/svelte/icons/speaker';
  import TentIcon from '@lucide/svelte/icons/tent';
  import CheckList from '../snippets/CheckList.svelte';
  import Headline from '../snippets/Headline.svelte';
  import { btn, btnLine, h2, rows } from '../lib/linen.ts';
  import { parallax, reveal } from '../lib/motion.ts';

  /** A centred closing block: heading, text, a checklist and buttons, with white icon tiles floating around it. */
  let { section }: { section: SectionInstance } = $props();
  const rt = getRuntime();
  const s = $derived(
    section.settings as {
      heading: string;
      highlight: string;
      text: string;
      checklist: string;
      button_label: string;
      button_link: string;
      second_label: string;
      second_link: string;
    },
  );
  // Tile positions (percent of the block), parallax speed and float delay.
  const tiles = [
    { Icon: CameraIcon, x: '4%', y: '8%', speed: 0.1, delay: '0s' },
    { Icon: TentIcon, x: '19%', y: '20%', speed: 0.18, delay: '-2s' },
    { Icon: BikeIcon, x: '9%', y: '64%', speed: 0.06, delay: '-4s' },
    { Icon: SpeakerIcon, x: '24%', y: '74%', speed: 0.14, delay: '-1s' },
    { Icon: SailboatIcon, x: '74%', y: '12%', speed: 0.12, delay: '-3s' },
    { Icon: DrillIcon, x: '89%', y: '22%', speed: 0.08, delay: '-5s' },
    { Icon: PartyPopperIcon, x: '70%', y: '70%', speed: 0.16, delay: '-2.5s' },
    { Icon: MicVocalIcon, x: '87%', y: '62%', speed: 0.1, delay: '-0.5s' },
  ];
</script>

<section class="relative mb-10 py-10 md:mb-16 lg:py-20" data-section="cta">
  <div class="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
    {#each tiles as t, i (i)}
      <div class="ln-float absolute" style:left={t.x} style:top={t.y} style:--ln-delay={t.delay} use:parallax={t.speed}>
        <div
          class="grid size-[5.5rem] place-items-center rounded-lg bg-white text-[var(--ln-signal)] shadow-[0_18px_40px_-24px_rgba(32,32,32,.35)]"
        >
          <t.Icon class="size-9" strokeWidth={1.5} />
        </div>
      </div>
    {/each}
  </div>
  <div class="mb-8 flex justify-center gap-3 lg:hidden" aria-hidden="true">
    {#each tiles.slice(0, 4) as t, i (i)}
      <div class="ln-float" style:--ln-delay={t.delay}>
        <div class="grid size-14 place-items-center rounded-lg bg-white text-[var(--ln-signal)]">
          <t.Icon class="size-6" strokeWidth={1.5} />
        </div>
      </div>
    {/each}
  </div>
  <div class="relative mx-auto flex max-w-2xl flex-col items-center gap-7 text-center">
    {#if s.heading}<Headline text={s.heading} mark={s.highlight} class={h2} />{/if}
    <div class="flex flex-col items-center gap-7" use:reveal>
      {#if s.text}<p class="max-w-[27rem] text-[1.0625rem] leading-relaxed whitespace-pre-line text-[#5e5e5e]">
          {s.text}
        </p>{/if}
      <CheckList items={rows(s.checklist)} class="items-start" />
      <div class="flex flex-wrap justify-center gap-3 pt-2">
        {#if s.button_label}<Button class={btn} href={s.button_link || rt.url.search?.() || rt.url.home()}
            >{s.button_label}</Button
          >{/if}
        {#if s.second_label && s.second_link}<Button variant="outline" class={btnLine} href={s.second_link}
            >{s.second_label}</Button
          >{/if}
      </div>
    </div>
  </div>
</section>
