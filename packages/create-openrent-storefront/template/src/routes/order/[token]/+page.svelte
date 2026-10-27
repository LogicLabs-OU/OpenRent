<script lang="ts">
  import Head from '#lib/Head.svelte';
  import { formatter } from '#lib/format.ts';
  import { translator } from '#lib/text.ts';

  let { data } = $props();
  const t = $derived(translator(data.shop.lang));
  const f = $derived(formatter(data.shop.lang, data.shop.timezone));
  const o = $derived(data.order);
</script>

<Head title={`#${o.number} · ${data.shop.name}`} noindex />

<h1>{t('order.title', { number: o.number })}</h1>
<p class="muted">{t('order.period', { from: f.when(o.starts_at), to: f.when(o.ends_at) })}{#if o.location} · {o.location.name}{/if}</p>
<table class="card" data-testid="order-lines">
  <tbody>
    {#each o.lines as l, i (i)}
      <tr><td>{l.quantity} × {l.description}</td><td class="num">{f.money(l.total)}</td></tr>
    {/each}
    <tr><th>{t('cart.total')}</th><td class="num"><strong>{f.money(o.totals.total)}</strong></td></tr>
    {#if o.totals.deposit.amount}<tr><th>{t('cart.deposit')}</th><td class="num">{f.money(o.totals.deposit)}</td></tr>{/if}
    {#if o.totals.balance.amount}<tr><th>{t('order.balance')}</th><td class="num">{f.money(o.totals.balance)}</td></tr>{/if}
  </tbody>
</table>
