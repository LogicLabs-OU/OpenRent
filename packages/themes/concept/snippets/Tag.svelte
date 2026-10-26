<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { TAGS, type TagColor } from '../lib/concept.ts';

  /** A soft coloured label, like a select or multi-select value. */
  let {
    color = 'gray',
    children,
    ...rest
  }: { color?: TagColor; children: Snippet } & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
  {...rest}
  class="inline-flex h-5 max-w-full items-center gap-1 truncate rounded-[3px] px-1.5 text-xs leading-5 whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0"
  style:background={TAGS[color][0]}
  style:color={TAGS[color][1]}>{@render children()}</span
>
