<script lang="ts">
  import type { Product, SectionInstance } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import CheckList from '../snippets/CheckList.svelte';
  import Headline from '../snippets/Headline.svelte';
  import Visual from '../snippets/Visual.svelte';
  import { btn, h2, rows } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

  /** A rounded card with text and a checklist on one side and the picture (or a booking card on beige) on the other. */
  let { section, products = [] }: { section: SectionInstance; products?: Product[] } = $props();
  const s = $derived(
    section.settings as {
      image: string;
      alt: string;
      heading: string;
      highlight: string;
      text: string;
      checklist: string;
      button_label: string;
      button_link: string;
      image_side: 'left' | 'right';
      tone: 'white' | 'grey' | 'beige';
    },
  );
</script>

<section
  class={[
    'mb-20 grid items-stretch gap-6 rounded-[20px] p-3 md:mb-28 md:grid-cols-2 md:gap-10 md:p-4',
    s.tone === 'grey' ? 'bg-[var(--ln-panel)]' : s.tone === 'beige' ? 'bg-[var(--ln-beige)]' : 'bg-white',
  ]}
  data-section="image-text"
>
  <div
    class={[
      'relative grid min-h-80 place-items-center overflow-hidden rounded-[16px] px-4 py-10',
      s.tone === 'beige' ? 'bg-white/50' : 'bg-[var(--ln-beige)]',
      s.image_side === 'right' && 'md:order-2',
    ]}
    use:reveal={'clip'}
  >
    {#if s.image}<img
        class="absolute inset-0 size-full object-cover"
        src={s.image}
        alt={s.alt}
        loading="lazy"
      />{:else}<Visual kind="booking" {products} />{/if}
  </div>
  <div class="flex flex-col items-start justify-center gap-6 px-3 py-6 md:px-8 md:py-14 lg:px-12">
    {#if s.heading}<Headline text={s.heading} mark={s.highlight} class={[h2, 'md:text-[2.75rem]']} />{/if}
    <div class="flex flex-col items-start gap-6" use:reveal>
      {#if s.text}<p class="text-lg leading-[1.45] whitespace-pre-line text-[#4d4d4d]">{s.text}</p>{/if}
      <CheckList items={rows(s.checklist)} />
      {#if s.button_label && s.button_link}<Button class={[btn, 'mt-2']} href={s.button_link}
          >{s.button_label}</Button
        >{/if}
    </div>
  </div>
</section>
