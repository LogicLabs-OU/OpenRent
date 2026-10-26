<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import Tag from './Tag.svelte';

  /** Green "n available" or red "not available" tag; nothing when no dates are chosen. */
  let { count }: { count: number | undefined } = $props();
  const rt = getRuntime();
</script>

{#if count !== undefined}
  {#if count > 0}<Tag color="green" data-availability="ok"
      ><span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>{rt.t('product.available', {
        count,
      })}</Tag
    >
  {:else}<Tag color="red" data-availability="none"
      ><span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>{rt.t(
        'product.unavailable',
      )}</Tag
    >{/if}
{/if}
