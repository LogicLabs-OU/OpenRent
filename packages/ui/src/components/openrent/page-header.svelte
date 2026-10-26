<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '#ui/utils.js';

  let { title, description, actions, children, class: className }: { title: string; description?: string; actions?: Snippet; children?: Snippet; class?: string } = $props();
</script>

<div class={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}>
  <div class="min-w-0 space-y-1">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
      {@render children?.()}
    </div>
    {#if description}<p class="text-sm text-muted-foreground">{description}</p>{/if}
  </div>
  {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</div>
