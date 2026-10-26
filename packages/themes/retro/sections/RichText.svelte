<script lang="ts">
  import { display, wrap } from '../lib/retro.ts';

  /** Plain paragraphs: blank lines separate them; no HTML is rendered. */
  let { heading, text, align }: { heading: string; text: string; align: string } = $props();
  const paragraphs = $derived(
    text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  );
</script>

<section class={[wrap, 'flex flex-col gap-6 py-16', align === 'center' && 'items-center text-center']}>
  {#if heading}<h2 class={[display, 'max-w-4xl']}>{heading}</h2>{/if}
  {#each paragraphs as p, i (i)}<p class="max-w-2xl text-lg leading-relaxed whitespace-pre-line md:text-xl">
      {p}
    </p>{/each}
</section>
