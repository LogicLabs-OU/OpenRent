<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Card from '#ui/components/ui/card/index.js';
  import { cn } from '#ui/utils.js';

  let { label, value, hint, tone, children }: { label: string; value?: string | number; hint?: string; tone?: 'default' | 'danger'; children?: Snippet } = $props();
</script>

<Card.Root size="sm">
  <Card.Header>
    <Card.Description>{label}</Card.Description>
    <Card.Title class={cn('text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-destructive')}>
      {#if children}{@render children()}{:else}{value}{/if}
    </Card.Title>
    {#if hint}<p class="text-xs text-muted-foreground">{hint}</p>{/if}
  </Card.Header>
</Card.Root>
