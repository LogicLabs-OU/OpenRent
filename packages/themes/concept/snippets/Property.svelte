<script lang="ts">
  import type { Component, Snippet } from 'svelte';

  /** One row of a page's properties: a grey name with its icon, then the value. Use inside a <dl>. */
  let {
    label,
    icon: Icon,
    children,
  }: { label: string; icon?: Component<{ class?: string }>; children: Snippet } = $props();
</script>

<div class="flex min-h-8 items-start text-sm">
  <dt class="text-muted-foreground flex w-36 shrink-0 items-center gap-1.5 py-1.5 pr-2 sm:w-44">
    {#if Icon}<Icon class="size-4 shrink-0" />{/if}<span class="truncate">{label}</span>
  </dt>
  <dd class="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1.5">{@render children()}</dd>
</div>
