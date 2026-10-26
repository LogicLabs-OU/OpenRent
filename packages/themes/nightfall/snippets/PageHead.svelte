<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '@openrent/ui/utils';
  import { h1 } from '../lib/nightfall.ts';

  /** The top of an inner page: a soft glow, a small label, the title and an optional line below. */
  let {
    title,
    eyebrow = '',
    center = false,
    glow = 'cool',
    children,
  }: { title: string; eyebrow?: string; center?: boolean; glow?: 'cool' | 'warm'; children?: Snippet } = $props();
</script>

<div class={cn('relative mb-10 flex flex-col gap-4 md:mb-14', center && 'items-center text-center')}>
  <div
    class={cn(
      'nf-glow -top-40 h-80 w-[min(900px,120vw)] opacity-50',
      glow === 'warm' ? 'nf-glow-warm' : 'nf-glow-cool',
      center ? 'left-1/2 -translate-x-1/2' : '-left-40',
    )}
    aria-hidden="true"
  ></div>
  {#if eyebrow}<p class="relative text-[0.8125rem] font-semibold text-white/60">{eyebrow}</p>{/if}
  <h1 class={cn(h1, 'relative max-w-4xl')}>{title}</h1>
  {#if children}<div class="relative">{@render children()}</div>{/if}
</div>
