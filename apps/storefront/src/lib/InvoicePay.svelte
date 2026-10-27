<script lang="ts">
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import Payment from './Payment.svelte';
  import { t } from './i18n/index.ts';

  /** Monthly invoices with something left to pay, each paid as a whole (ADR 0012). */
  type Money = { amount: number; currency: string };
  type Invoice = { id: string; number: string | null; issued_at: string; due_at: string | null; due: Money };
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0], params: Record<string, string | number> = {}) => t(key, params, locale);
  const money = (m: Money) => new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amount / 100);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const invoices = $derived((page.data.portal?.me?.invoices ?? []) as Invoice[]);
  let busy = $state<string | null>(null);
  let failed = $state('');
  let card = $state<{ id: string; clientSecret: string; publishableKey: string; returnUrl: string } | null>(null);

  async function pay(id: string) {
    busy = id;
    failed = '';
    try {
      const res = await fetch('/_or/account/pay-invoice', { method: 'POST', headers: { 'content-type': 'application/json', ...(locale ? { 'x-or-locale': locale } : {}) }, body: JSON.stringify({ invoice_id: id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? res.statusText);
      if (body.redirect_url) return void (window.location.href = body.redirect_url);
      if (body.client_secret && body.public_config?.publishable_key) card = { id, clientSecret: body.client_secret, publishableKey: body.public_config.publishable_key, returnUrl: body.order_url };
      else window.location.href = body.order_url;
    } catch (err) {
      failed = (err as Error).message;
    } finally {
      busy = null;
    }
  }
</script>

{#if invoices.length}
  <Card.Root data-testid="account-invoices">
    <Card.Header><Card.Title>{tr('account.invoices.title')}</Card.Title><Card.Description>{tr('account.invoices.hint')}</Card.Description></Card.Header>
    <Card.Content class="flex flex-col gap-3">
      {#each invoices as inv (inv.id)}
        <div class="flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="account-invoice">
          <span>{tr('account.invoices.item', { number: inv.number ?? '', date: date(inv.issued_at) })}{#if inv.due_at} · {tr('account.invoices.due', { date: date(inv.due_at) })}{/if}</span>
          <Button size="sm" disabled={!!busy} onclick={() => pay(inv.id)}>{#if busy === inv.id}<Spinner />{/if}{tr('account.owed.pay', { amount: money(inv.due) })}</Button>
        </div>
        {#if card?.id === inv.id}<Payment clientSecret={card.clientSecret} publishableKey={card.publishableKey} returnUrl={card.returnUrl} onerror={(m) => (failed = m)} />{/if}
      {/each}
      {#if failed}<p class="text-destructive text-sm" role="alert">{failed}</p>{/if}
    </Card.Content>
  </Card.Root>
{/if}
