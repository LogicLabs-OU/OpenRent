<script lang="ts">
  import { getRuntime, type OrderConfirmationData } from '@openrent/theme-sdk';
  import * as Alert from '@openrent/ui/alert';
  import { Button } from '@openrent/ui/button';
  import CalendarPlusIcon from '@lucide/svelte/icons/calendar-plus';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import CreditCardIcon from '@lucide/svelte/icons/credit-card';
  import { Spinner } from '@openrent/ui/spinner';
  import { toast } from 'svelte-sonner';
  import CancelRequest from '../snippets/CancelRequest.svelte';
  import Documents from '../snippets/Documents.svelte';
  import DamageCharges from '../snippets/DamageCharges.svelte';
  import ExtendRequest from '../snippets/ExtendRequest.svelte';
  import { box, boxHead, cta, label } from '../lib/marquee.ts';

  let { data }: { data: OrderConfirmationData } = $props();
  const rt = getRuntime();
  const o = $derived(data.order);
  let payment = $state<{ clientSecret: string; publishableKey: string } | null>(null);
  let paymentError = $state('');
  let starting = $state(false);

  async function pay() {
    if (!rt.payOrder) return;
    starting = true;
    paymentError = '';
    try {
      const r = await rt.payOrder(o.token);
      if (r.clientSecret && r.publishableKey)
        payment = { clientSecret: r.clientSecret, publishableKey: r.publishableKey };
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      starting = false;
    }
  }
  const returnUrl = $derived(
    typeof location === 'undefined' ? '' : new URL(rt.url.order(o.token), location.href).href,
  );
  const ics = $derived.by(() => {
    const f = (s: string) =>
      new Date(s)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    const summary = rt.t('order.calendar_title', { shop: rt.shop.tenant.name, number: o.number });
    const body = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenRent//EN',
      'BEGIN:VEVENT',
      `UID:${o.id}@openrent`,
      `DTSTART:${f(o.starts_at)}`,
      `DTEND:${f(o.ends_at)}`,
      `SUMMARY:${summary}`,
      `LOCATION:${o.location?.name ?? ''}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
  });
</script>

<div class="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-10">
  <div class="flex min-w-0 flex-col gap-6">
    <div class="flex flex-col gap-4 border-b border-(--mq-ink) pb-6">
      <span class="mq-mono flex w-fit items-center gap-2 bg-(--mq-accent) px-2.5 py-1 text-xs text-(--mq-on-accent) uppercase"
        ><CircleCheckIcon class="size-3.5" aria-hidden="true" />#{o.number}</span
      >
      <h1 class="mq-tight text-[clamp(2.5rem,5.5vw,5rem)] leading-[0.9] font-bold text-balance uppercase">
        {rt.t('order.thanks', {
          number: o.number,
          status: o.status === 'quote' ? rt.t('order.status_awaiting') : rt.t('order.status_confirmed'),
        })}
      </h1>
    </div>
    {#if data.payment_result === 'failed'}
      <Alert.Root variant="destructive"
        ><CircleAlertIcon /><Alert.Title>{rt.t('order.payment_failed')}</Alert.Title></Alert.Root
      >
    {:else if data.payment_result === 'processing' && o.payment_pending}
      <Alert.Root>
        <ClockIcon /><Alert.Title>{rt.t('order.payment_processing')}</Alert.Title>
        <Alert.Description
          ><Button variant="link" class="h-auto p-0" href={rt.url.order(o.token)} data-sveltekit-reload
            >{rt.t('order.refresh')}</Button
          ></Alert.Description
        >
      </Alert.Root>
    {:else if data.payment_result === 'succeeded' && !o.payment_pending}
      <Alert.Root><CircleCheckIcon /><Alert.Title>{rt.t('order.payment_succeeded')}</Alert.Title></Alert.Root>
    {:else if o.payment_pending}
      <Alert.Root><ClockIcon /><Alert.Title>{rt.t('order.pending_payment')}</Alert.Title></Alert.Root>
    {/if}
    {#if o.payable && rt.payOrder && data.payment_result !== 'processing'}
      <section class={box} data-testid="order-payment" aria-labelledby="or-pay-title">
        <h2 id="or-pay-title" class={boxHead}>{rt.t('order.pay_title')}</h2>
        <div class="flex flex-col gap-4 p-4 md:p-6">
          <p class="text-muted-foreground text-lg uppercase">{rt.t('order.pay_hint')}</p>
          {#if paymentError}<Alert.Root variant="destructive"
              ><CircleAlertIcon /><Alert.Title>{paymentError}</Alert.Title></Alert.Root
            >{/if}
          {#if payment}
            <rt.components.Payment
              clientSecret={payment.clientSecret}
              publishableKey={payment.publishableKey}
              {returnUrl}
              onerror={(m) => (paymentError = m)}
            />
          {/if}
        </div>
        {#if !payment}
          <Button class={[cta, 'w-full justify-between border-t border-(--mq-ink)']} onclick={pay} disabled={starting}>
            <span class="flex items-center gap-3"
              >{#if starting}<Spinner />{:else}<CreditCardIcon />{/if}{rt.t('order.pay_now', {
                amount: rt.format.money(o.amount_due ?? o.totals.balance),
              })}</span
            ><ArrowRightIcon class="mq-arrow" />
          </Button>
        {/if}
      </section>
    {/if}
    <section class={box} aria-labelledby="or-details">
      <h2 id="or-details" class={boxHead}>{rt.t('order.details')}</h2>
      <dl class="mq-cells -mx-px -mt-px grid sm:grid-cols-2">
        <div class="flex flex-col gap-1 px-4 py-3 md:px-6">
          <dt class={label}>{rt.t('dates.pickup')}</dt>
          <dd class="mq-mono text-sm">{rt.format.datetime(o.starts_at)}</dd>
        </div>
        <div class="flex flex-col gap-1 px-4 py-3 md:px-6">
          <dt class={label}>{rt.t('dates.return')}</dt>
          <dd class="mq-mono text-sm">{rt.format.datetime(o.ends_at)}</dd>
        </div>
        {#if o.location}<div class="flex flex-col gap-1 px-4 py-3 sm:col-span-2 md:px-6">
            <dt class={label}>{o.location.name}</dt>
            <dd class="text-lg uppercase">
              {[o.location.address?.line1, o.location.address?.city].filter(Boolean).join(', ')}
            </dd>
          </div>{/if}
      </dl>
      <dl class="flex flex-col gap-2.5 p-4 text-base uppercase md:p-6" data-testid="order-lines">
        {#each o.lines as l, i (i)}<div class="flex justify-between gap-4">
            <dt class="font-semibold">{l.quantity} × {l.description}</dt>
            <dd class="mq-mono text-sm">{rt.format.money(l.total)}</dd>
          </div>{/each}
        <div class="flex items-baseline justify-between gap-4 border-t border-(--mq-ink) pt-3">
          <dt class="mq-tight text-[1.75rem] leading-none font-bold">{rt.t('price.total')}</dt>
          <dd class="mq-mono text-xl font-semibold">{rt.format.money(o.totals.total)}</dd>
        </div>
        {#if o.totals.deposit.amount}<div class="text-muted-foreground flex justify-between gap-4">
            <dt>{rt.t('price.deposit')}</dt>
            <dd class="mq-mono text-sm">{rt.format.money(o.totals.deposit)}</dd>
          </div>{/if}
      </dl>
      <div class="flex flex-wrap gap-3 border-t border-(--mq-ink) p-4 md:px-6">
        <Button variant="outline" class="h-10 border-(--mq-ink)" href={ics} download={`booking-${o.number}.ics`}
          ><CalendarPlusIcon />{rt.t('order.add_calendar')}</Button
        >
        <Documents documents={o.documents} attachments={o.attachments} orderToken={o.token} />
      </div>
    </section>
    <DamageCharges charges={o.damage_charges} orderToken={o.token} />
    {#if o.can_request_extension || o.extension_request}
      <section class={box} data-testid="order-extension" aria-labelledby="or-extend">
        <h2 id="or-extend" class={boxHead}>{rt.t('extend.section')}</h2>
        <div class="p-4 md:p-6">
          <ExtendRequest
            order={{ id: o.id, token: o.token }}
            endsAt={o.ends_at}
            request={o.extension_request}
            can={!!o.can_request_extension}
          />
        </div>
      </section>
    {/if}
    {#if o.can_request_cancellation || o.cancellation_request}
      <section class={box} data-testid="order-cancellation" aria-labelledby="or-cancel">
        <h2 id="or-cancel" class={boxHead}>{rt.t('cancel.section')}</h2>
        <div class="p-4 md:p-6">
          <CancelRequest
            order={{ id: o.id, token: o.token }}
            request={o.cancellation_request}
            can={!!o.can_request_cancellation}
          />
        </div>
      </section>
    {/if}
  </div>
  <section class={[box, 'h-fit lg:sticky lg:top-[calc(var(--mq-head)+1rem)]']} aria-label={rt.t('order.show_qr')}>
    <div class="flex items-center justify-between gap-4 bg-(--mq-accent) px-5 py-4 text-(--mq-on-accent)">
      <span class="mq-tight truncate text-[1.75rem] leading-none font-bold uppercase">{rt.shop.tenant.name}</span>
      <span class="mq-mono shrink-0 text-sm">#{o.number}</span>
    </div>
    <div class="flex flex-col items-center gap-4 p-6">
      <div class="size-52 border border-(--mq-ink) bg-white p-2 [&_svg]:size-full" data-testid="order-qr">
        {@html o.qr_svg}
      </div>
    </div>
    <p class="mq-perf px-5 py-4 text-center text-lg font-semibold uppercase">{rt.t('order.show_qr')}</p>
    <!-- Calendar links (theme API 1.9). -->
    <rt.components.Slot name="order.actions" context={{ order: o }} />
  </section>
</div>
