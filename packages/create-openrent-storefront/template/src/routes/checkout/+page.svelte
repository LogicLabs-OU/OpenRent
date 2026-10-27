<script lang="ts">
  import Head from '#lib/Head.svelte';
  import { formatter } from '#lib/format.ts';
  import { translator } from '#lib/text.ts';

  let { data, form } = $props();
  const t = $derived(translator(data.shop.lang));
  const f = $derived(formatter(data.shop.lang, data.shop.timezone));
  const v = $derived(form?.values ?? { name: '', email: '', phone: '', notes: '' });
  const err = (field: string) => form?.fields?.[field];
</script>

<Head title={`${t('checkout.title')} · ${data.shop.name}`} noindex />

<h1>{t('checkout.title')}</h1>
<p class="muted">{t('cart.period', { from: f.when(data.cart.starts_at), to: f.when(data.cart.ends_at) })} · {t('cart.total')} {f.money(data.cart.quote?.total)}</p>

<form method="POST" action="?/place" class="stack" novalidate>
  <label>{t('checkout.name')}<input name="name" autocomplete="name" value={v.name} required aria-invalid={err('customer.name') ? 'true' : undefined} /></label>
  {#if err('customer.name')}<p class="error">{err('customer.name')}</p>{/if}
  <label>{t('checkout.email')}<input name="email" type="email" autocomplete="email" value={v.email} required aria-invalid={err('customer.email') ? 'true' : undefined} /></label>
  {#if err('customer.email')}<p class="error">{err('customer.email')}</p>{/if}
  <label>{t('checkout.phone')}<input name="phone" type="tel" autocomplete="tel" value={v.phone} /></label>
  <label>{t('checkout.notes')}<textarea name="notes" rows="3">{v.notes}</textarea></label>
  <details>
    <summary>{t('checkout.terms_show')}</summary>
    <div style="white-space: pre-wrap">{data.terms.text}</div>
  </details>
  <label class="check"><input type="checkbox" name="terms" aria-invalid={err('terms_accepted') ? 'true' : undefined} />{t('checkout.terms')}</label>
  {#if err('terms_accepted')}<p class="error">{err('terms_accepted')}</p>{/if}
  {#if form?.message && !Object.keys(form.fields ?? {}).some((k) => k.startsWith('customer.') || k === 'terms_accepted')}<p class="error" role="alert">{form.message}</p>{/if}
  <button class="primary">{t('checkout.place')}</button>
</form>
