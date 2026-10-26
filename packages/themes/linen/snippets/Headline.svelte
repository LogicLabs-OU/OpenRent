<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import { headingLines } from '../lib/linen.ts';
  import { reveal } from '../lib/motion.ts';

  /**
   * A heading with one bronze, underlined word. Each line of the text is its own clip-masked line that slides up
   * when it scrolls into view, or straight away inside an `.ln-intro` (the home hero).
   */
  let {
    text,
    mark = '',
    tag = 'h2',
    class: className = '',
    id,
  }: {
    text: string;
    mark?: string | false;
    tag?: 'h1' | 'h2' | 'h3';
    class?: ClassValue;
    id?: string;
  } = $props();
  const lines = $derived(headingLines(text, mark));
</script>

{#if lines.length}
  <svelte:element this={tag} {id} class={className} use:reveal={'lines'}>
    {#each lines as line, i (i)}<span class="ln-line" style:--i={i}
        ><span
          >{#each line as w, j (j)}{#if j}{' '}{/if}{#if w.mark}<span class="ln-mark">{w.word.replace(/[.,!?;:…]+$/u, '')}</span
              >{w.word.match(/[.,!?;:…]+$/u)?.[0] ?? ''}{:else}{w.word}{/if}{/each}</span
        ></span
      >{/each}
  </svelte:element>
{/if}
