<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import ImageIcon from '@lucide/svelte/icons/image';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { col, h2 } from '../lib/concept.ts';

  /** Two columns: a picture block and a text block. */
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
    },
  );
</script>

<section class={[col, 'mb-10 grid items-center gap-6 md:grid-cols-2 md:gap-12']}>
  <div
    class={[
      'flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[4px] bg-(--concept-wash)',
      s.image_side === 'right' && 'md:order-2',
    ]}
  >
    {#if s.image}<img
        class="size-full object-cover"
        src={s.image}
        alt={s.alt}
        loading="lazy"
      />{:else}<ImageIcon class="text-muted-foreground size-8" aria-hidden="true" />{/if}
  </div>
  <div class="flex flex-col items-start gap-2">
    {#if s.heading}<h2 class={[h2, 'mb-1']}>{s.heading}</h2>{/if}
    {#if s.text}<p class="leading-7 whitespace-pre-line">{s.text}</p>{/if}
    {#if s.button_label && s.button_link}<Button class="mt-2" variant="outline" size="sm" href={s.button_link}
        >{s.button_label}<ArrowRightIcon /></Button
      >{/if}
  </div>
</section>
