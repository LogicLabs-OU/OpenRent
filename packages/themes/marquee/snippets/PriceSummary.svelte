<script lang="ts">
  import { getRuntime, type PriceQuote } from '@openrent/theme-sdk';
  import { periodLabel } from '../lib/marquee.ts';

  /** Lines and totals like a box-office receipt: capitals on the left, mono amounts on the right. */
  let { quote }: { quote: PriceQuote } = $props();
  const rt = getRuntime();
  const row = 'flex items-start justify-between gap-4';
</script>

<dl class="flex flex-col gap-2.5 text-base uppercase" data-testid="price-summary">
  {#each quote.lines as l (l.key)}
    <div class={row}>
      <dt class="font-semibold">
        {l.quantity} × {l.name}
        {#if l.period_unit}<div class="text-muted-foreground text-sm font-medium">
            {periodLabel(rt.t, l.charge_periods, l.period_unit)}
          </div>{/if}
      </dt>
      <dd class="mq-mono text-sm">{rt.format.money(l.subtotal)}</dd>
    </div>
  {/each}
  <div class="my-1 border-t border-dashed border-(--mq-ink)"></div>
  {#if quote.discount.amount}
    <div class={row}>
      <dt>{rt.t('price.discount')}</dt>
      <dd class="mq-mono text-sm">−{rt.format.money(quote.discount)}</dd>
    </div>
  {/if}
  <div class={[row, 'text-muted-foreground']}>
    <dt>{rt.t('price.tax')}</dt>
    <dd class="mq-mono text-sm">{rt.format.money(quote.tax)}</dd>
  </div>
  <div class={[row, 'items-baseline border-t border-(--mq-ink) pt-3']} data-testid="price-total">
    <dt class="mq-tight text-[1.75rem] leading-none font-bold">{rt.t('price.total')}</dt>
    <dd class="mq-mono text-xl font-semibold">{rt.format.money(quote.total)}</dd>
  </div>
  {#if quote.deposit.amount}
    <div class={[row, 'text-muted-foreground']}>
      <dt>{rt.t('price.deposit')}</dt>
      <dd class="mq-mono text-sm">{rt.format.money(quote.deposit)}</dd>
    </div>
  {/if}
</dl>
