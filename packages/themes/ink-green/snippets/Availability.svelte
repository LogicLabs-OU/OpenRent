<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleXIcon from '@lucide/svelte/icons/circle-x';

  /** "n available" in ink and lime, or "not available" in soft red; nothing without dates. Meant for sage panels. */
  let { count }: { count: number | undefined } = $props();
  const rt = getRuntime();
  const pill =
    'inline-flex h-7 w-fit items-center gap-1.5 rounded-full px-3 text-xs font-medium [&_svg]:size-3.5';
</script>

{#if count !== undefined}
  {#if count > 0}<span class={[pill, 'bg-[#043f2e] text-[#c8f169]']} data-availability="ok"
      ><CircleCheckIcon />{rt.t('product.available', { count })}</span
    >
  {:else}<span class={[pill, 'bg-[#ffbbbe] text-[#6e1a20]']} data-availability="none"
      ><CircleXIcon />{rt.t('product.unavailable')}</span
    >{/if}
{/if}
