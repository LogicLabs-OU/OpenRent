<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import ImageIcon from '@lucide/svelte/icons/image';
  import { big, h3, panel } from '../lib/ink.ts';

  /** A sage panel (or a lime one) with a picture and a block of text side by side. */
  let { section }: { section: SectionInstance } = $props();
  const s = $derived(
    section.settings as {
      image: string;
      alt: string;
      heading: string;
      text: string;
      button_label: string;
      button_link: string;
      image_side: 'left' | 'right';
      tone: 'sage' | 'lime';
    },
  );
</script>

<section
  class={[
    panel,
    'mb-16 grid items-center gap-6 p-4 md:mb-24 md:grid-cols-2 md:gap-10 md:p-6',
    s.tone === 'lime' && 'bg-[#c8f169]',
  ]}
>
  <div
    class={[
      'flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-[#2a6f2b]',
      s.image_side === 'right' && 'md:order-2',
    ]}
  >
    {#if s.image}<img
        class="size-full object-cover"
        src={s.image}
        alt={s.alt}
        loading="lazy"
      />{:else}<ImageIcon class="size-10 text-[#c8f169]" aria-hidden="true" />{/if}
  </div>
  <div class="flex flex-col items-start gap-4 p-2 md:p-6">
    {#if s.heading}<h2 class={[h3, 'md:text-5xl']}>{s.heading}</h2>{/if}
    {#if s.text}<p class="text-lg leading-relaxed whitespace-pre-line">{s.text}</p>{/if}
    {#if s.button_label && s.button_link}<Button class={[big, 'mt-2']} href={s.button_link}
        >{s.button_label}</Button
      >{/if}
  </div>
</section>
