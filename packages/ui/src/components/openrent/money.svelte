<script lang="ts">
  import { cn } from '#ui/utils.js';
  import { formatMoney, type MoneyValue } from './format.js';

  let { value, locale, class: className }: { value: MoneyValue | null | undefined; locale?: string; class?: string } = $props();
</script>

<span class={cn('tabular-nums', className)}>{formatMoney(value, locale)}</span>
