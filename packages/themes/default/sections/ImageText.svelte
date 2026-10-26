<script lang="ts">
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import ImageIcon from '@lucide/svelte/icons/image';

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

<section class="mb-10 grid items-center gap-6 md:grid-cols-2 md:gap-10">
  <div
    class={[
      'bg-muted flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl',
      s.image_side === 'right' && 'md:order-2',
    ]}
  >
    {#if s.image}<img
        class="size-full object-cover"
        src={s.image}
        alt={s.alt}
        loading="lazy"
      />{:else}<ImageIcon class="text-muted-foreground size-10" aria-hidden="true" />{/if}
  </div>
  <div class="flex flex-col items-start gap-3">
    {#if s.heading}<h2 class="text-2xl font-semibold tracking-tight">{s.heading}</h2>{/if}
    {#if s.text}<p class="text-muted-foreground leading-7 whitespace-pre-line">{s.text}</p>{/if}
    {#if s.button_label && s.button_link}<Button href={s.button_link}>{s.button_label}</Button>{/if}
  </div>
</section>
