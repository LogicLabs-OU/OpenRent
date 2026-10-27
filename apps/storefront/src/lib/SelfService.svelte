<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { getRuntime } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { t } from './i18n/index.ts';

  /**
   * Upcoming bookings the customer may change themselves (ADR 0012): cancel with the refund the shop's
   * rules give now, or move to other days (directly, or as a request when the shop wants to decide).
   * Pickup and return keep their times of day.
   */
  type Money = { amount: number; currency: string };
  type Order = { id: string; number: number; starts_at: string; ends_at: string; self_service?: { cancel: { refund_pct: number } | null; change_dates: 'self' | 'request' | null } };
  const rt = getRuntime();
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0], params: Record<string, string | number> = {}) => t(key, params, locale);
  const money = (m: Money) => new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amount / 100);
  const orders = $derived(((page.data.account?.orders ?? []) as Order[]).filter((o) => o.self_service?.cancel || o.self_service?.change_dates));
  let open = $state<{ id: string; kind: 'cancel' | 'change' } | null>(null);
  let from = $state('');
  let to = $state('');
  let preview = $state<{ available: boolean; amount: Money; problem?: { message: string } | null } | null>(null);
  let errors = $state<Record<string, string>>({});
  let failed = $state('');
  let busy = $state(false);
  let done = $state('');

  function start(o: Order, kind: 'cancel' | 'change') {
    open = { id: o.id, kind };
    from = rt.zone.localDate(o.starts_at);
    to = rt.zone.localDate(o.ends_at);
    preview = null;
    errors = {};
    failed = '';
    done = '';
  }
  const dates = (o: Order) => ({ starts_at: rt.zone.toInstant(from, rt.zone.localTime(o.starts_at)), ends_at: rt.zone.toInstant(to, rt.zone.localTime(o.ends_at)) });

  async function call(body: Record<string, unknown>) {
    const res = await fetch('/_or/account/self-service', { method: 'POST', headers: { 'content-type': 'application/json', ...(locale ? { 'x-or-locale': locale } : {}) }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.message ?? res.statusText), { status: res.status, fields: json.errors ?? [] });
    return json;
  }
  async function run(fn: () => Promise<void>) {
    busy = true;
    errors = {};
    failed = '';
    try {
      await fn();
    } catch (err: any) {
      if (err.status === 422 && err.fields.length) errors = Object.fromEntries(err.fields.map((f: { field: string; message: string }) => [f.field, f.message]));
      else failed = err.message;
    } finally {
      busy = false;
    }
  }
  const check = (o: Order) => run(async () => (preview = await call({ action: 'change', order_id: o.id, ...dates(o), dry_run: true })));
  const move = (o: Order) =>
    run(async () => {
      const r = await call({ action: 'change', order_id: o.id, ...dates(o) });
      done = r.mode === 'request' ? tr('selfservice.asked') : tr('selfservice.moved');
      open = null;
      await invalidateAll();
    });
  const cancel = (o: Order) =>
    run(async () => {
      await call({ action: 'cancel', order_id: o.id });
      done = tr('selfservice.cancelled');
      open = null;
      await invalidateAll();
    });
</script>

{#if orders.length || done}
  <Card.Root data-testid="account-self-service">
    <Card.Header><Card.Title>{tr('selfservice.title')}</Card.Title><Card.Description>{tr('selfservice.hint')}</Card.Description></Card.Header>
    <Card.Content class="flex flex-col gap-4">
      {#if done}<p role="status" class="text-sm">{done}</p>{/if}
      {#each orders as o (o.id)}
        <div class="flex flex-col gap-3 rounded-lg border p-3 text-sm" data-testid="self-service-order">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium">{tr('account.owed.booking', { number: o.number })} · {rt.format.datetime(o.starts_at)}</span>
            <div class="flex flex-wrap gap-1">
              {#if o.self_service?.change_dates}<Button size="sm" variant="outline" onclick={() => start(o, 'change')}>{tr('selfservice.change')}</Button>{/if}
              {#if o.self_service?.cancel}<Button size="sm" variant="ghost" onclick={() => start(o, 'cancel')}>{tr('selfservice.cancel')}</Button>{/if}
            </div>
          </div>
          {#if open?.id === o.id && open.kind === 'cancel'}
            <div class="flex flex-col gap-2">
              <p>{o.self_service?.cancel?.refund_pct ? tr('selfservice.refund', { percent: o.self_service.cancel.refund_pct }) : tr('selfservice.no_refund')}</p>
              <div class="flex gap-2"><Button size="sm" variant="destructive" disabled={busy} onclick={() => cancel(o)}>{#if busy}<Spinner />{/if}{tr('selfservice.cancel_confirm')}</Button><Button size="sm" variant="ghost" onclick={() => (open = null)}>{tr('selfservice.keep')}</Button></div>
            </div>
          {:else if open?.id === o.id && open.kind === 'change'}
            <div class="flex flex-col gap-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <Field.Field data-invalid={!!errors.starts_at || undefined}>
                  <Field.Label for="or-ss-from-{o.id}">{tr('selfservice.pickup_day')}</Field.Label>
                  <Input id="or-ss-from-{o.id}" type="date" bind:value={from} oninput={() => (preview = null)} aria-invalid={!!errors.starts_at} />
                  {#if errors.starts_at}<Field.Error>{errors.starts_at}</Field.Error>{/if}
                </Field.Field>
                <Field.Field data-invalid={!!errors.ends_at || undefined}>
                  <Field.Label for="or-ss-to-{o.id}">{tr('selfservice.return_day')}</Field.Label>
                  <Input id="or-ss-to-{o.id}" type="date" bind:value={to} oninput={() => (preview = null)} aria-invalid={!!errors.ends_at} />
                  {#if errors.ends_at}<Field.Error>{errors.ends_at}</Field.Error>{/if}
                </Field.Field>
              </div>
              {#each Object.entries(errors).filter(([k]) => k !== 'starts_at' && k !== 'ends_at') as [k, m] (k)}<p class="text-destructive">{m}</p>{/each}
              {#if preview}
                <p role="status" data-testid="self-service-preview">
                  {#if !preview.available}{tr('selfservice.not_free')}{:else if preview.amount.amount > 0}{tr('selfservice.costs_more', { amount: money(preview.amount) })}{:else if preview.amount.amount < 0}{tr('selfservice.costs_less', { amount: money({ ...preview.amount, amount: -preview.amount.amount }) })}{:else}{tr('selfservice.same_price')}{/if}
                </p>
              {/if}
              <div class="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy || !from || !to} onclick={() => check(o)}>{tr('selfservice.check')}</Button>
                <Button size="sm" disabled={busy || !preview?.available} onclick={() => move(o)}>{#if busy}<Spinner />{/if}{o.self_service?.change_dates === 'request' ? tr('selfservice.ask') : tr('selfservice.move')}</Button>
                <Button size="sm" variant="ghost" onclick={() => (open = null)}>{tr('selfservice.keep')}</Button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
      {#if failed}<p class="text-destructive text-sm" role="alert">{failed}</p>{/if}
    </Card.Content>
  </Card.Root>
{/if}
