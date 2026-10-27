<script lang="ts">
  import { getRuntime, type OrderConfirmationData } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import * as Alert from '@openrent/ui/alert';
  import { Button } from '@openrent/ui/button';
  import { Separator } from '@openrent/ui/separator';
  import CalendarPlusIcon from '@lucide/svelte/icons/calendar-plus';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import ClockIcon from '@lucide/svelte/icons/clock';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import CreditCardIcon from '@lucide/svelte/icons/credit-card';
  import { Spinner } from '@openrent/ui/spinner';
  import { toast } from 'svelte-sonner';
  import CancelRequest from '../snippets/CancelRequest.svelte';
  import Documents from '../snippets/Documents.svelte';
  import DamageCharges from '../snippets/DamageCharges.svelte';
  import ExtendRequest from '../snippets/ExtendRequest.svelte';
  import { big, h1 } from '../lib/nightfall.ts';

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

<div class="relative grid gap-6 lg:grid-cols-[1.5fr_1fr]">
  <div class="nf-glow nf-glow-warm -top-40 -left-40 h-96 w-[min(900px,120vw)] opacity-50" aria-hidden="true"></div>
  <div class="relative flex flex-col gap-6">
    <div class="flex flex-col items-start gap-5">
      <span
        class="grid size-14 place-items-center rounded-2xl bg-gradient-to-b from-[color-mix(in_oklab,var(--nf-accent)_70%,white)] to-(--nf-accent) shadow-[0_10px_30px_-8px_var(--nf-accent)]"
        ><CircleCheckIcon class="size-7 text-white" aria-hidden="true" /></span
      >
      <h1 class={[h1, 'md:text-5xl']}>
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
      <Card.Root data-testid="order-payment">
        <Card.Header>
          <Card.Title>{rt.t('order.pay_title')}</Card.Title>
          <Card.Description>{rt.t('order.pay_hint')}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
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
          {:else}
            <Button class={big} onclick={pay} disabled={starting}>
              {#if starting}<Spinner />{:else}<CreditCardIcon />{/if}{rt.t('order.pay_now', {
                amount: rt.format.money(o.amount_due ?? o.totals.balance),
              })}
            </Button>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}
    <Card.Root>
      <Card.Header><Card.Title>{rt.t('order.details')}</Card.Title></Card.Header>
      <Card.Content class="flex flex-col gap-4 text-sm">
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt class="text-white/55">{rt.t('dates.pickup')}</dt>
          <dd class="font-medium">{rt.format.datetime(o.starts_at)}</dd>
          <dt class="text-white/55">{rt.t('dates.return')}</dt>
          <dd class="font-medium">{rt.format.datetime(o.ends_at)}</dd>
          {#if o.location}<dt class="text-muted-foreground">{o.location.name}</dt>
            <dd>{[o.location.address?.line1, o.location.address?.city].filter(Boolean).join(', ')}</dd>{/if}
        </dl>
        <Separator />
        <dl class="flex flex-col gap-2" data-testid="order-lines">
          {#each o.lines as l, i (i)}<div class="flex justify-between gap-4">
              <dt>{l.quantity} × {l.description}</dt>
              <dd class="tabular-nums">{rt.format.money(l.total)}</dd>
            </div>{/each}
          <Separator class="my-1" />
          <div class="flex justify-between gap-4 text-base font-semibold">
            <dt>{rt.t('price.total')}</dt>
            <dd class="tabular-nums">{rt.format.money(o.totals.total)}</dd>
          </div>
          {#if o.totals.deposit.amount}<div class="text-muted-foreground flex justify-between gap-4">
              <dt>{rt.t('price.deposit')}</dt>
              <dd class="tabular-nums">{rt.format.money(o.totals.deposit)}</dd>
            </div>{/if}
        </dl>
      </Card.Content>
      <Card.Footer class="flex-wrap gap-3">
        <Button variant="outline" class="rounded-full" href={ics} download={`booking-${o.number}.ics`}
          ><CalendarPlusIcon />{rt.t('order.add_calendar')}</Button
        >
        <Documents documents={o.documents} attachments={o.attachments} orderToken={o.token} />
      </Card.Footer>
    </Card.Root>
    <DamageCharges charges={o.damage_charges} orderToken={o.token} />
    {#if o.can_request_extension || o.extension_request}
      <Card.Root data-testid="order-extension">
        <Card.Header><Card.Title>{rt.t('extend.section')}</Card.Title></Card.Header>
        <Card.Content><ExtendRequest order={{ id: o.id, token: o.token }} endsAt={o.ends_at} request={o.extension_request} can={!!o.can_request_extension} /></Card.Content>
      </Card.Root>
    {/if}
    {#if o.can_request_cancellation || o.cancellation_request}
      <Card.Root data-testid="order-cancellation">
        <Card.Header><Card.Title>{rt.t('cancel.section')}</Card.Title></Card.Header>
        <Card.Content
          ><CancelRequest
            order={{ id: o.id, token: o.token }}
            request={o.cancellation_request}
            can={!!o.can_request_cancellation}
          /></Card.Content
        >
      </Card.Root>
    {/if}
  </div>
  <Card.Root class="relative h-fit items-center text-center lg:sticky lg:top-24">
    <Card.Content class="flex flex-col items-center gap-3">
      <div class="size-52 rounded-3xl bg-white p-3 shadow-[0_20px_60px_-10px_var(--nf-accent)] [&_svg]:size-full" data-testid="order-qr">
        {@html o.qr_svg}
      </div>
      <p class="text-muted-foreground text-sm">{rt.t('order.show_qr')}</p>
      <!-- Calendar links (theme API 1.9). -->
      <rt.components.Slot name="order.actions" context={{ order: o }} />
    </Card.Content>
  </Card.Root>
</div>
