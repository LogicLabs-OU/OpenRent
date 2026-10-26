<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

  /** "Learn more ›" style link; the bronze chevron bounces on hover. Without `href` it is plain text inside a link. */
  let { href, label, class: className = '' }: { href?: string; label: string; class?: ClassValue } = $props();
</script>

<svelte:element
  this={href ? 'a' : 'span'}
  {href}
  class={[
    'ln-more inline-flex w-fit items-center gap-1.5 text-base font-medium text-[#202020] underline-offset-4 hover:underline',
    className,
  ]}>{label}<ChevronRightIcon class="size-4" aria-hidden="true" /></svelte:element
>
