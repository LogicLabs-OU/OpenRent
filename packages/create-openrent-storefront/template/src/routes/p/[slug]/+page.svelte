<script lang="ts">
  import Head from '#lib/Head.svelte';
  import { summary } from '#lib/summary.ts';
  import { formatter } from '#lib/format.ts';
  import { translator } from '#lib/text.ts';

  let { data, form } = $props();
  const t = $derived(translator(data.shop.lang));
  const f = $derived(formatter(data.shop.lang, data.shop.timezone));
  const p = $derived(data.product);
</script>

<Head title={p.seo?.title ?? `${p.name} · ${data.shop.name}`} description={p.seo?.description ?? summary(p.description)} image={p.images[0]?.url ?? data.shop.seo.image} />

<div class="row" style="align-items: start">
  {#if p.images[0]}<img src={p.images[0].url} alt={p.images[0].alt ?? p.name} style="max-width: 28rem; width: 100%; border-radius: 0.75rem" />{/if}
  <div class="stack">
    <h1>{p.name}</h1>
    {#if p.description_html}<div>{@html p.description_html}</div>{:else if p.description}<p>{p.description}</p>{/if}
    {#if p.deposit_amount.amount}<p class="muted">{t('product.deposit', { amount: f.money(p.deposit_amount) })}</p>{/if}

    <form method="POST" action="?/add" class="stack">
      <fieldset class="stack" style="border: 0; padding: 0">
        <legend>{t('product.period')}</legend>
        <div class="row">
          <label>{t('product.pickup')}<input type="datetime-local" name="from" value={data.period.from} required aria-invalid={form?.dateError ? 'true' : undefined} /></label>
          <label>{t('product.return')}<input type="datetime-local" name="to" value={data.period.to} required aria-invalid={form?.dateError ? 'true' : undefined} /></label>
          <button formaction="?/check">{t('product.check')}</button>
        </div>
        {#if form?.dateError}<p class="error" role="alert">{t('error.dates')}</p>{/if}
      </fieldset>
      {#if p.variants.length > 1}
        <select name="variant_id" aria-label={p.name}>
          {#each p.variants as v (v.id)}<option value={v.id}>{v.name} · {v.price?.description ?? ''}</option>{/each}
        </select>
      {:else}
        <input type="hidden" name="variant_id" value={p.variants[0]?.id} />
        {#if p.variants[0]?.price}<p><strong>{p.variants[0].price.description}</strong></p>{/if}
      {/if}
      {#if data.checked && p.variants.length === 1 && p.variants[0]?.available != null}
        <p class={p.variants[0].available > 0 ? 'muted' : 'error'}>{p.variants[0].available > 0 ? t('product.available', { count: p.variants[0].available }) : t('product.unavailable')}</p>
      {/if}
      <label style="max-width: 8rem">{t('product.quantity')}<input type="number" name="quantity" min="1" value="1" /></label>
      {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
      <button class="primary">{t('product.add')}</button>
    </form>
  </div>
</div>
