<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';

  /** "n available" in a blue-ruled box, or "not available" on signal orange; nothing without dates. */
  let { count }: { count: number | undefined } = $props();
  const rt = getRuntime();
  const tag = 'inline-flex h-7 w-fit items-center gap-2 border px-2.5 text-[0.8125rem] font-semibold uppercase';
</script>

{#if count !== undefined}
  {#if count > 0}<span class={[tag, 'border-(--mq-accent) text-(--mq-accent)']} data-availability="ok"
      ><span class="size-2 bg-(--mq-accent)" aria-hidden="true"></span>{rt.t('product.available', { count })}</span
    >
  {:else}<span
      class={[tag, 'border-(--mq-accent-2) bg-(--mq-accent-2) text-(--mq-on-accent-2)']}
      data-availability="none"
      ><span class="size-2 bg-current" aria-hidden="true"></span>{rt.t('product.unavailable')}</span
    >{/if}
{/if}
