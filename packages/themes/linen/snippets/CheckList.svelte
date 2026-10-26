<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  /** Lines with bronze outlined circle checks. */
  let { items, class: className = '' }: { items: string[]; class?: ClassValue } = $props();
</script>

{#if items.length}
  <ul class={['flex flex-col gap-3', className]}>
    {#each items as item, i (i)}
      <li class="flex items-start gap-3 text-base font-medium text-[#202020] md:text-[1.0625rem]">
        <svg class="mt-px size-6 shrink-0 text-[var(--ln-accent)]" viewBox="0 0 24 24" fill="none" aria-hidden="true"
          ><circle cx="12" cy="12" r="11" stroke="currentColor" stroke-width="1.4" /><path
            d="m7.5 12.2 3 3 6-6.4"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          /></svg
        >
        <span class="text-left">{item}</span>
      </li>
    {/each}
  </ul>
{/if}
