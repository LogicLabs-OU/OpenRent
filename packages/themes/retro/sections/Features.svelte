<script lang="ts">
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
  import QrCodeIcon from '@lucide/svelte/icons/qr-code';
  import { STICKERS, wrap } from '../lib/retro.ts';

  let { items }: { items: { title: string; text: string }[] } = $props();
  const icons = [CalendarDaysIcon, ReceiptTextIcon, QrCodeIcon];
</script>

<section class={[wrap, 'grid gap-6 py-16 md:grid-cols-3']}>
  {#each items as f, i (i)}
    {@const Icon = icons[i % icons.length]!}
    <article class="flex flex-col gap-6 rounded-[1.25rem] border border-black/40 bg-white p-8">
      <span
        class={[
          'grid size-16 place-items-center rounded-xl border border-black shadow-[4px_4px_0_0_#000]',
          i % 2 ? 'rotate-6' : '-rotate-6',
        ]}
        style:background={STICKERS[(i + 1) % STICKERS.length]}
        aria-hidden="true"
      >
        <Icon class="size-8" strokeWidth={1.75} />
      </span>
      <h3 class="text-3xl leading-tight tracking-tight">{f.title}</h3>
      <p class="text-lg leading-relaxed">{f.text}</p>
    </article>
  {/each}
</section>
