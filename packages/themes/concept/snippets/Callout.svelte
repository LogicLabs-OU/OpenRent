<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A grey block with an emoji in front: hints and notices. */
  let {
    icon = '💡',
    children,
    class: cls = '',
    role,
  }: { icon?: string; children: Snippet; class?: string; role?: 'status' | 'alert' } = $props();
</script>

<div class={['flex gap-3 rounded-[4px] bg-(--muted) px-4 py-3.5 text-[0.9375rem] leading-6', cls]} {role}>
  <span class="shrink-0 text-xl leading-6" aria-hidden="true">{icon}</span>
  <div class="min-w-0 flex-1">{@render children()}</div>
</div>
