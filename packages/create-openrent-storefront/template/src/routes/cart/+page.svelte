<script lang="ts">
  import Head from '#lib/Head.svelte';
  import { formatter } from '#lib/format.ts';
  import { translator } from '#lib/text.ts';

  let { data, form } = $props();
  const t = $derived(translator(data.shop.lang));
  const f = $derived(formatter(data.shop.lang, data.shop.timezone));
  const q = $derived(data.cart?.quote ?? null);
  const problems = $derived((data.cart?.availability ?? []).flatMap((a) => a.problems.map((p) => p.message)));
</script>

<Head title={`${t('cart.title')} · ${data.shop.name}`} noindex />

<h1>{t('cart.title')}</h1>
{#if !data.cart || !data.cart.lines.length}
  <p class="muted">{t('cart.empty')}</p>
{:else}
  <p class="muted">{t('cart.period', { from: f.when(data.cart.starts_at), to: f.when(data.cart.ends_at) })}</p>
  <form method="POST" action="?/update" class="card">
    <table data-testid="cart-lines">
      <tbody>
        {#each data.cart.lines as l, i (l.variant_id)}
          {@const priced = q?.lines.find((x) => x.key === String(i))}
          <tr>
            <td>{l.product_name}{#if l.variant_name && l.variant_name !== 'Default'} · {l.variant_name}{/if}</td>
            <td style="width: 7rem"><input type="number" min="0" name={`qty:${l.variant_id}`} value={l.quantity} aria-label={t('cart.quantity_of', { name: l.product_name ?? '' })} style="width: 5rem" /></td>
            <td class="num">{f.money(priced?.total)}</td>
            <td style="width: 1%"><button name="drop" value={l.variant_id}>{t('cart.remove')}</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p><button>{t('cart.update')}</button></p>
  </form>
  {#each problems as p (p)}<p class="error" role="alert">{p}</p>{/each}
  {#if data.cart.quote_error}<p class="error" role="alert">{data.cart.quote_error.message}</p>{/if}
  {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
  {#if q}
    <table style="max-width: 24rem; margin-left: auto" data-testid="cart-totals">
      <tbody>
        <tr><th>{t('cart.subtotal')}</th><td class="num">{f.money(q.subtotal)}</td></tr>
        {#if q.discount.amount}<tr><th>{t('cart.discount')}</th><td class="num">−{f.money(q.discount)}</td></tr>{/if}
        {#if q.fees.amount}<tr><th>{t('cart.fees')}</th><td class="num">{f.money(q.fees)}</td></tr>{/if}
        <tr><th>{t('cart.tax')}</th><td class="num">{f.money(q.tax)}</td></tr>
        <tr><th>{t('cart.total')}</th><td class="num"><strong>{f.money(q.total)}</strong></td></tr>
        {#if q.deposit.amount}<tr><th>{t('cart.deposit')}</th><td class="num">{f.money(q.deposit)}</td></tr>{/if}
      </tbody>
    </table>
    {#if !problems.length && !data.cart.quote_error}<p style="text-align: right"><a class="button primary" href="/checkout">{t('cart.checkout')}</a></p>{/if}
  {/if}
{/if}
