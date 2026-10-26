<script lang="ts">
  import { Badge } from '#ui/components/ui/badge/index.js';
  import { cn } from '#ui/utils.js';
  import { TONE_CLASSES, humanize, statusTone } from './format.js';

  let { status, label, class: className }: { status: string; label?: string; class?: string } = $props();
</script>

<Badge variant="outline" class={cn('gap-1.5 font-medium', TONE_CLASSES[statusTone(status)], className)}>
  <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
  {label ?? humanize(status)}
</Badge>
