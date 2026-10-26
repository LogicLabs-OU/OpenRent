<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';

  /** "n available" with a green light, or "not available" in soft red; nothing without dates. */
  let { count }: { count: number | undefined } = $props();
  const rt = getRuntime();
  const pill =
    'inline-flex h-7 w-fit items-center gap-2 rounded-full border px-3 text-xs font-medium backdrop-blur-md';
</script>

{#if count !== undefined}
  {#if count > 0}<span class={[pill, 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200']} data-availability="ok"
      ><span class="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" aria-hidden="true"></span>{rt.t(
        'product.available',
        { count },
      )}</span
    >
  {:else}<span class={[pill, 'border-rose-400/25 bg-rose-400/10 text-rose-200']} data-availability="none"
      ><span class="size-1.5 rounded-full bg-rose-400" aria-hidden="true"></span>{rt.t('product.unavailable')}</span
    >{/if}
{/if}
