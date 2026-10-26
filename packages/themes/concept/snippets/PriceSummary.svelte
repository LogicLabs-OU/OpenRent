<script lang="ts">
  import { getRuntime, type PriceQuote } from '@openrent/theme-sdk';
  import { Separator } from '@openrent/ui/separator';
  import { periodLabel } from '../lib/concept.ts';

  let { quote }: { quote: PriceQuote } = $props();
  const rt = getRuntime();
</script>

<dl class="flex flex-col gap-2 text-sm" data-testid="price-summary">
  {#each quote.lines as l (l.key)}
    <div class="flex items-start justify-between gap-4">
      <dt>
        {l.quantity} × {l.name}
        {#if l.period_unit}<div class="text-muted-foreground text-xs">
            {periodLabel(rt.t, l.charge_periods, l.period_unit)}
          </div>{/if}
      </dt>
      <dd class="tabular-nums">{rt.format.money(l.subtotal)}</dd>
    </div>
  {/each}
  <Separator class="my-1" />
  {#if quote.discount.amount}
    <div class="flex justify-between gap-4">
      <dt>{rt.t('price.discount')}</dt>
      <dd class="tabular-nums">−{rt.format.money(quote.discount)}</dd>
    </div>
  {/if}
  <div class="text-muted-foreground flex justify-between gap-4">
    <dt>{rt.t('price.tax')}</dt>
    <dd class="tabular-nums">{rt.format.money(quote.tax)}</dd>
  </div>
  <div class="flex justify-between gap-4 text-base font-semibold" data-testid="price-total">
    <dt>{rt.t('price.total')}</dt>
    <dd class="tabular-nums">{rt.format.money(quote.total)}</dd>
  </div>
  {#if quote.deposit.amount}
    <div class="text-muted-foreground flex justify-between gap-4">
      <dt>{rt.t('price.deposit')}</dt>
      <dd class="tabular-nums">{rt.format.money(quote.deposit)}</dd>
    </div>
  {/if}
</dl>
