<script lang="ts">
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Table from '@openrent/ui/table';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as Item from '@openrent/ui/item';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Separator } from '@openrent/ui/separator';
  import { Kbd } from '@openrent/ui/kbd';
  import { Spinner } from '@openrent/ui/spinner';
  import { Money, PageHeader } from '@openrent/ui/openrent';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import UserPlusIcon from '@lucide/svelte/icons/user-plus';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { api, fromLocalInput, session, t, toast, notifyError, fieldErrors, toLocalInput } from '#lib';
  import { to } from '#lib/nav.ts';
  import AvailabilityElsewhere from '#lib/components/availability-elsewhere.svelte';
  import ProductPicker, { type PickedVariant } from '#lib/components/product-picker.svelte';
  import OrderSuggestions from '#lib/components/order-suggestions.svelte';

  const tomorrow = new Date(Date.now() + 86400_000);
  tomorrow.setMinutes(0, 0, 0);
  let starts = $state(toLocalInput(new Date(tomorrow.setHours(10))));
  let ends = $state(toLocalInput(new Date(tomorrow.getTime() + 2 * 86400_000)));
  let locationId = $state(session.locationId || (session.locations[0]?.id ?? ''));
  let customer = $state<any>(null);
  let customerQ = $state('');
  let customerHits = $state<any[]>([]);
  let newCustomer = $state<{ name: string; email: string; phone: string } | null>(null);
  let lines = $state<{ variant_id: string; quantity: number; label: string; product_id?: string }[]>([]);
  let coupon = $state('');
  let quote = $state<any>(null);
  let avail = $state<Record<string, number | null>>({});
  let quoteError = $state('');
  let notes = $state('');
  let po = $state('');
  let cycle = $state('');
  let busy = $state(false);
  let errors = $state<Record<string, string>>({});
  let timer: ReturnType<typeof setTimeout>;


  function searchCustomers() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      customerHits = customerQ.trim().length < 2 ? [] : (await api.get(`/customers?q=${encodeURIComponent(customerQ)}&limit=8`)).data;
    }, 150);
  }

  function addLine(v: PickedVariant) {
    const existing = lines.find((l) => l.variant_id === v.id);
    if (existing) existing.quantity++;
    else lines.push({ variant_id: v.id, quantity: 1, label: v.label, product_id: v.product_id });
  }

  let reqId = 0;
  $effect(() => {
    const payload = lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity }));
    void coupon;
    void locationId;
    if (!payload.length || !starts || !ends) {
      quote = null;
      return;
    }
    const id = ++reqId;
    const timeout = setTimeout(async () => {
      try {
        const s = fromLocalInput(starts);
        const e = fromLocalInput(ends);
        const q = await api.post('/price_quote', { location_id: locationId || null, starts_at: s, ends_at: e, lines: payload, coupon_codes: coupon ? [coupon] : [], customer_id: customer?.id ?? null });
        const a = await api.post('/availability/batch', { variant_ids: [...new Set(payload.map((l) => l.variant_id))], location_id: locationId || undefined, from: s, to: e });
        if (id !== reqId) return;
        quote = q;
        avail = Object.fromEntries(a.data.map((x: any) => [x.variant_id, x.available]));
        quoteError = '';
      } catch (err) {
        if (id === reqId) quoteError = (err as Error).message;
      }
    }, 250);
    return () => clearTimeout(timeout);
  });

  async function create(reserve: boolean) {
    errors = {};
    // The server checks it again at reserve; asking here keeps the booking from being left as a draft.
    if (reserve && customer?.b2b?.po_required && !po.trim()) {
      errors = { po_number: t('order.po_required') };
      document.getElementById('po')?.focus();
      return;
    }
    busy = true;
    try {
      let customerId = customer?.id ?? null;
      if (!customerId && newCustomer?.name) {
        customerId = (await api.post('/customers', { name: newCustomer.name, email: newCustomer.email || null, phone: newCustomer.phone || null })).id;
      }
      const o = await api.post('/orders', {
        customer_id: customerId,
        location_id: locationId || null,
        starts_at: fromLocalInput(starts),
        ends_at: fromLocalInput(ends),
        lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
        coupon_codes: coupon ? [coupon] : [],
        notes: notes ? { internal: notes } : undefined,
        po_number: po.trim() || null,
        billing_cycle: cycle || null,
      });
      if (reserve) {
        try {
          await api.post(`/orders/${o.id}/actions/reserve`, {});
          toast.success(t('order.toast.reserved', { number: o.number }));
        } catch (e) {
          notifyError(e);
        }
      } else toast.success(t('order.toast.draft', { number: o.number }));
      goto(to(`/orders/${o.id}`));
    } catch (e) {
      errors = fieldErrors(e);
      notifyError(e);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && lines.length) create(true);
  }
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>{t('action.new_order')} · OpenRent</title></svelte:head>

<PageHeader title={t('action.new_order')} description={t('new_order.description')} />

<div class="grid gap-6 lg:grid-cols-[1fr_360px]">
  <div class="flex flex-col gap-6">
    <Card.Root>
      <Card.Header><Card.Title>{t('new_order.customer')}</Card.Title><Card.Description>{t('new_order.customer_hint')}</Card.Description></Card.Header>
      <Card.Content>
        {#if customer}
          <Item.Root variant="outline">
            <Item.Content><Item.Title>{customer.name}</Item.Title><Item.Description>{[customer.email, customer.phone].filter(Boolean).join(' · ')}</Item.Description></Item.Content>
            <Item.Actions><Button variant="ghost" size="sm" onclick={() => (customer = null)}>{t('common.change')}</Button></Item.Actions>
          </Item.Root>
          {#if customer.flags?.blocked}<Alert.Root variant="destructive" class="mt-3"><CircleAlertIcon /><Alert.Title>{t('customer.blocked_warning')}</Alert.Title></Alert.Root>{/if}
        {:else if newCustomer}
          <Field.Group class="grid gap-4 sm:grid-cols-3">
            <Field.Field><Field.Label for="nc-name">{t('field.name')}</Field.Label><Input id="nc-name" bind:value={newCustomer.name} /></Field.Field>
            <Field.Field><Field.Label for="nc-email">{t('field.email')}</Field.Label><Input id="nc-email" type="email" bind:value={newCustomer.email} /></Field.Field>
            <Field.Field><Field.Label for="nc-phone">{t('field.phone')}</Field.Label><Input id="nc-phone" bind:value={newCustomer.phone} /></Field.Field>
          </Field.Group>
          <Button variant="link" size="sm" class="mt-2 px-0" onclick={() => (newCustomer = null)}>{t('new_order.search_existing')}</Button>
        {:else}
          <Input placeholder={t('new_order.customer_search')} bind:value={customerQ} oninput={searchCustomers} aria-label={t('new_order.customer_search')} />
          {#if customerHits.length}
            <Item.Group class="mt-2 rounded-md border">
              {#each customerHits as c (c.id)}
                <Item.Root size="sm">
                  {#snippet child({ props })}
                    <button type="button" {...props} onclick={() => (customer = c)}>
                      <Item.Content><Item.Title>{c.name}</Item.Title></Item.Content>
                      <Item.Description>{c.email ?? c.phone ?? ''}</Item.Description>
                    </button>
                  {/snippet}
                </Item.Root>
              {/each}
            </Item.Group>
          {/if}
          <Button variant="outline" size="sm" class="mt-3" onclick={() => (newCustomer = { name: customerQ, email: '', phone: '' })}><UserPlusIcon />{t('new_order.new_customer')}</Button>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title>{t('new_order.period')}</Card.Title><Card.Description>{t('common.timezone_note', { tz: session.tz })}</Card.Description></Card.Header>
      <Card.Content>
        <Field.Group class="grid gap-4 sm:grid-cols-3">
          <Field.Field data-invalid={!!errors.starts_at || undefined}>
            <Field.Label for="starts">{t('field.pickup')}</Field.Label>
            <Input id="starts" type="datetime-local" bind:value={starts} />
            {#if errors.starts_at}<Field.Error>{errors.starts_at}</Field.Error>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!errors.ends_at || undefined}>
            <Field.Label for="ends">{t('field.return')}</Field.Label>
            <Input id="ends" type="datetime-local" bind:value={ends} />
            {#if errors.ends_at}<Field.Error>{errors.ends_at}</Field.Error>{/if}
          </Field.Field>
          {#if !session.singleLocation}
            <Field.Field>
              <Field.Label for="loc">{t('field.location')}</Field.Label>
              <NativeSelect.Root id="loc" class="w-full" bind:value={locationId}>{#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
            </Field.Field>
          {/if}
        </Field.Group>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title>{t('new_order.items')}</Card.Title><Card.Description>{t('new_order.items_hint')}</Card.Description></Card.Header>
      <Card.Content class="flex flex-col gap-4">
        <ProductPicker visibility="public,hidden" onpick={addLine} />
        <OrderSuggestions productIds={lines.map((l) => l.product_id).filter((x): x is string => !!x)} onadd={addLine} />
        {#if lines.length}
          <div class="overflow-hidden rounded-lg border">
            <Table.Root>
              <Table.Header class="bg-muted/50"><Table.Row><Table.Head>{t('new_order.item')}</Table.Head><Table.Head class="w-24">{t('field.quantity')}</Table.Head><Table.Head>{t('new_order.available')}</Table.Head><Table.Head class="text-right">{t('orders.col.total')}</Table.Head><Table.Head class="w-10"></Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {#each lines as l, i (l.variant_id)}
                  {@const ql = quote?.lines?.[i]}
                  {@const a = avail[l.variant_id]}
                  {@const short = a !== null && a !== undefined && a < l.quantity}
                  <Table.Row>
                    <Table.Cell class="whitespace-normal"><div class="font-medium">{l.label}</div>{#if ql?.explanation?.length}<div class="text-xs text-muted-foreground">{ql.explanation.join(' · ')}</div>{/if}</Table.Cell>
                    <Table.Cell><Input type="number" min="1" class="w-20" bind:value={l.quantity} aria-label={t('field.quantity')} /></Table.Cell>
                    <Table.Cell class={short ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                      {a === null ? '∞' : a ?? '…'}{#if short} · {t('new_order.short_by', { count: l.quantity - a })}{/if}
                      {#if short && starts && ends}<div><AvailabilityElsewhere variantId={l.variant_id} name={l.label} {locationId} from={fromLocalInput(starts)} until={fromLocalInput(ends)} needed={l.quantity - a} /></div>{/if}
                    </Table.Cell>
                    <Table.Cell class="text-right"><Money value={ql?.total} /></Table.Cell>
                    <Table.Cell><Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onclick={() => lines.splice(i, 1)}><TrashIcon /></Button></Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header><Card.Title>{t('order.notes_internal')}</Card.Title></Card.Header>
      <Card.Content><Textarea bind:value={notes} aria-label={t('order.notes_internal')} /></Card.Content>
    </Card.Root>
  </div>

  <div>
    <Card.Root class="lg:sticky lg:top-20">
      <Card.Header><Card.Title>{t('new_order.summary')}</Card.Title></Card.Header>
      <Card.Content class="flex flex-col gap-4">
        <Field.Field><Field.Label for="coupon">{t('field.coupon')}</Field.Label><Input id="coupon" bind:value={coupon} /></Field.Field>
        <Field.Field>
          <Field.Label for="cycle">{t('order.billing')}</Field.Label>
          <NativeSelect.Root id="cycle" class="w-full" bind:value={cycle}>
            <NativeSelect.Option value="">{t('order.billing.once')}</NativeSelect.Option>
            <NativeSelect.Option value="weekly">{t('order.billing.weekly')}</NativeSelect.Option>
            <NativeSelect.Option value="monthly">{t('order.billing.monthly')}</NativeSelect.Option>
          </NativeSelect.Root>
          {#if cycle}<Field.Description>{t('order.billing.hint')}</Field.Description>{/if}
        </Field.Field>
        <Field.Field data-invalid={!!errors.po_number || undefined}>
          <Field.Label for="po">{t('order.po_number')}</Field.Label>
          <Input id="po" bind:value={po} required={!!customer?.b2b?.po_required} aria-invalid={!!errors.po_number} />
          {#if errors.po_number}<Field.Error>{errors.po_number}</Field.Error>{:else if customer?.b2b?.on_account}<Field.Description>{t('order.on_account_hint', { days: customer.b2b.payment_terms_days ?? 14 })}</Field.Description>{/if}
        </Field.Field>
        {#if quote}
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-muted-foreground">{t('price.subtotal')}</dt><dd><Money value={quote.subtotal} /></dd></div>
            {#if quote.discount.amount}<div class="flex justify-between"><dt class="text-muted-foreground">{t('price.discount')}</dt><dd>−<Money value={quote.discount} /></dd></div>{/if}
            <div class="flex justify-between"><dt class="text-muted-foreground">{t('price.tax')}</dt><dd><Money value={quote.tax} /></dd></div>
            <Separator />
            <div class="flex justify-between text-base font-semibold"><dt>{t('price.total')}</dt><dd><Money value={quote.total} /></dd></div>
            <div class="flex justify-between text-muted-foreground"><dt>{t('price.deposit')}</dt><dd><Money value={quote.deposit} /></dd></div>
          </dl>
          {#each quote.coupon_errors as ce}<p class="text-sm text-destructive">{ce.code}: {t(`coupon.error.${ce.reason}` as any)}</p>{/each}
        {:else if quoteError}
          <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{quoteError}</Alert.Title></Alert.Root>
        {:else}
          <p class="text-sm text-muted-foreground">{t('new_order.add_items_for_price')}</p>
        {/if}
      </Card.Content>
      <Card.Footer class="flex flex-col gap-2">
        <Button class="w-full" onclick={() => create(true)} disabled={busy || !lines.length || (!customer && !newCustomer?.name)}>{#if busy}<Spinner />{/if}{t('new_order.create_reserve')}<Kbd class="ml-auto">⌘↵</Kbd></Button>
        <Button class="w-full" variant="outline" onclick={() => create(false)} disabled={busy || (!lines.length && !customer)}>{t('new_order.save_draft')}</Button>
      </Card.Footer>
    </Card.Root>
  </div>
</div>
