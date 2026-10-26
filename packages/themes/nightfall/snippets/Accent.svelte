<script lang="ts">
  import { accentParts } from '../lib/nightfall.ts';

  /** Headline text where *starred* words switch to the handwritten (or serif italic) accent font. */
  let { text }: { text: string } = $props();
  const parts = $derived(accentParts(text));
</script>

{#each parts as part, i (i)}{#if part.accent}<span class="nf-accent">{part.text}</span>{:else}{part.text}{/if}{/each}
