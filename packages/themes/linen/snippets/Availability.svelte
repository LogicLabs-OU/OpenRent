<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';

  /** "n available" with a bronze dot, or "not available" in red; nothing without dates. */
  let { count }: { count: number | undefined } = $props();
  const rt = getRuntime();
  const pill = 'inline-flex h-7 w-fit items-center gap-2 rounded-full px-3 text-xs font-medium';
</script>

{#if count !== undefined}
  {#if count > 0}<span class={[pill, 'bg-[#f3efe6] text-[#5c4a1e]']} data-availability="ok"
      ><span class="size-1.5 rounded-full bg-[#2f9e5b]" aria-hidden="true"></span>{rt.t('product.available', {
        count,
      })}</span
    >
  {:else}<span class={[pill, 'bg-[#fdecea] text-[#8f1f15]']} data-availability="none"
      ><span class="size-1.5 rounded-full bg-[#d92d20]" aria-hidden="true"></span>{rt.t('product.unavailable')}</span
    >{/if}
{/if}
