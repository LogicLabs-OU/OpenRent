<script lang="ts">
  import PluginSlot from '#lib/components/plugin-slot.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Tabs from '@openrent/ui/tabs';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as Alert from '@openrent/ui/alert';
  import * as InputGroup from '@openrent/ui/input-group';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Separator } from '@openrent/ui/separator';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Spinner } from '@openrent/ui/spinner';
  import { StatusBadge, Money, PageHeader, SignaturePad, formatMoney } from '@openrent/ui/openrent';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import ScanBarcodeIcon from '@lucide/svelte/icons/scan-barcode';
  import XIcon from '@lucide/svelte/icons/x';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import FileDownIcon from '@lucide/svelte/icons/file-down';
  import SendIcon from '@lucide/svelte/icons/send';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import MessageSquareWarningIcon from '@lucide/svelte/icons/message-square-warning';
  import { api, upload, ApiError, dt, rel, toast, notifyError, fieldErrors, session, minorFromInput, majorFromMinor, fromLocalInput, toLocalInput, openHtml, confirmAction, getLocale, t } from '#lib';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { to, setScanHandler } from '#lib/nav.ts';
  import { beep } from '#lib/scanner.ts';
  import PhotoStrip from '#lib/components/photo-strip.svelte';
  import AttachmentsCard from '#lib/components/attachments-card.svelte';
  import TagInput from '#lib/components/tag-input.svelte';
  import CustomFieldsForm from '#lib/components/custom-fields-form.svelte';
  import PercentIcon from '@lucide/svelte/icons/percent';
  import EndChangeDialog from '#lib/components/end-change-dialog.svelte';
  import ExtensionRequestAlert from '#lib/components/extension-request-alert.svelte';
  import SwapUnitDialog from '#lib/components/swap-unit-dialog.svelte';
  import DeliveriesCard from '#lib/components/deliveries-card.svelte';
  import InspectionRunner from '#lib/components/inspection-runner.svelte';
  import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';

  const id = $derived(page.params.id!);
  let o = $state<any>(null);
  let timeline = $state<any[]>([]);
  let busy = $state('');
  let scanInput = $state('');
  let scanMsg = $state<{ ok: boolean; text: string } | null>(null);
  let products = $state<any[]>([]);
  let addPick = $state('');
  let sigName = $state('');
  let tab = $state('payments');

  let checkInOpen = $state(false);
  let checkIn = $state<{ units: Record<string, string>; bulk: Record<string, number> }>({ units: {}, bulk: {} });
  let inspectOpen = $state(false);
  let inspect = $state<{ units: Record<string, string>; charges: { description: string; amount: string }[] }>({ units: {}, charges: [] });
  let cancelOpen = $state(false);
  let cancel = $state({ reason: '', refund: true });
  let payOpen = $state(false);
  let pay = $state({ amount: '', method: 'cash', purpose: 'rental' });
  // Custom field values, edited in the notes card and saved together.
  let extras = $state<Record<string, any> | null>(null);
  let extrasErrors = $state<Record<string, string>>({});
  async function saveExtras(e: SubmitEvent) {
    e.preventDefault();
    extrasErrors = {};
    try {
      await api.patch(`/orders/${o.id}`, { custom_fields: extras });
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      extrasErrors = fieldErrors(err);
      if (!Object.keys(extrasErrors).length) notifyError(err);
    }
  }
  let discountOpen = $state(false);
  let discount = $state({ description: '', mode: 'amount' as 'amount' | 'percent', value: '' });
  let discountErrors = $state<Record<string, string>>({});
  async function addDiscount(e: SubmitEvent) {
    e.preventDefault();
    discountErrors = {};
    const value = Number(discount.value.replace(',', '.'));
    try {
      await api.post(`/orders/${o.id}/lines`, {
        type: 'discount',
        description: discount.description.trim() || undefined,
        ...(discount.mode === 'percent' ? { percent_bp: Math.round(value * 100) } : { amount: minorFromInput(discount.value) }),
      });
      discountOpen = false;
      toast.success(t('order.toast.discount_added'));
      await load();
    } catch (err) {
      // The amount error belongs next to the value; anything else goes to a toast.
      const fe = fieldErrors(err);
      const value = fe['lines[0].amount'] ?? fe['lines[0].percent_bp'];
      discountErrors = value ? { value } : {};
      if (!value) notifyError(err);
    }
  }
  /** "3 days" in the admin language, from the line's price snapshot. */
  const periods = (s: any) => (s?.period_unit && s?.charge_periods ? t(`period.count.${s.period_unit}` as any, { count: s.charge_periods }) : '');
  let requestOpen = $state(false);
  let requestForm = $state({ amount: '', message: '', notify: true });
  let requestErrors = $state<Record<string, string>>({});

  async function sendRequest(e: SubmitEvent) {
    e.preventDefault();
    requestErrors = {};
    try {
      await api.post(`/orders/${o.id}/payment_requests`, { amount: minorFromInput(requestForm.amount), message: requestForm.message || undefined, notify: requestForm.notify });
      requestOpen = false;
      toast.success(requestForm.notify ? t('payment_request.sent', { email: o.customer?.email ?? '' }) : t('payment_request.created'));
      if (!requestForm.notify) await navigator.clipboard.writeText(o.public_url).catch(() => undefined);
      await load();
    } catch (err) {
      requestErrors = fieldErrors(err);
      if (!Object.keys(requestErrors).length) notifyError(err);
    }
  }
  let captureOpen = $state(false);
  let captureDeposit = $state<any>(null);
  let capture = $state({ amount: '', reason: '' });
  let damageOpen = $state(false);
  let damage = $state({ description: '', amount: '' });
  let datesOpen = $state(false);
  // Extend or bring the return forward on a confirmed or picked-up rental (FR-OR-9).
  let endChange = $state<'extend' | 'return_early'>('extend');
  let endOpen = $state(false);
  // Swap a unit that is out (FR-OR-10).
  let swapping = $state<{ stock_item_id: string; barcode: string } | null>(null);
  let swapOpen = $state(false);
  // Booking past stock after a reserve was refused (FR-AV-8).
  let overbook = $state<{ message: string; reason: string; error: string } | null>(null);
  const endChangeable = $derived(o && ['reserved', 'prepared', 'out'].includes(o.status) && session.can('orders:write'));
  let dates = $state({ starts: '', ends: '' });

  // Customer cancellation request (from the storefront) and the dialog that answers it.
  let cancelReq = $state<any>(null);
  let decide = $state<{ mode: 'approve' | 'decline'; refund: string; note: string; policyPct: number } | null>(null);
  let deciding = $state(false);

  async function load() {
    try {
      o = await api.get(`/orders/${id}?expand=customer,payments,payment_requests,deposits,documents,damage_charges,notifications,location`);
      extras = { ...(o.custom_fields ?? {}) };
      timeline = (await api.get(`/orders/${id}/timeline`)).data;
      cancelReq = (await api.get(`/orders/${id}/cancellation_request`)).request;
      if (!sigName) sigName = o.customer?.name ?? '';
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(() => {
    load();
    api.get('/products?limit=200').then((r) => (products = r.data));
    return setScanHandler(handleScan);
  });

  const editable = $derived(o && ['draft', 'quote'].includes(o.status));
  const primary = $derived(o?.actions.find((a: any) => a.primary) ?? o?.actions.find((a: any) => a.enabled));
  const others = $derived(o?.actions.filter((a: any) => a !== primary) ?? []);
  const allUnits = $derived(o ? o.lines.flatMap((l: any) => [l, ...l.components]).flatMap((l: any) => l.units.map((u: any) => ({ ...u, line: l.description, meter_unit: l.meter_unit }))) : []);
  // Meter readings at pickup and return (FR-CAT-10), by unit; errors come back by position in the list sent.
  let meters = $state<Record<string, string>>({});
  let meterErrors = $state<Record<string, string>>({});
  let meterOrder: string[] = [];
  function readings(units: any[]) {
    const filled = units.filter((u: any) => u.meter_unit && String(meters[u.stock_item_id] ?? '').trim() !== '');
    meterOrder = filled.map((u: any) => u.stock_item_id);
    meterErrors = {};
    return filled.length ? filled.map((u: any) => ({ stock_item_id: u.stock_item_id, value: Number(meters[u.stock_item_id]) })) : undefined;
  }
  const pickupMeters = $derived(allUnits.filter((u: any) => u.meter_unit && !u.checked_out_at && !u.replaced));
  const bulkLines = $derived(o ? o.lines.flatMap((l: any) => (l.components.length ? l.components : [l])).filter((l: any) => l.tracking === 'bulk' && l.type === 'rental') : []);
  const openDeposit = $derived(o?.deposits?.find((x: any) => ['pending', 'held', 'failed', 'expired'].includes(x.status)));
  const variantOptions = $derived(products.flatMap((p) => p.variants.map((v: any) => ({ id: v.id, label: v.name === p.name ? p.name : `${p.name} – ${v.name}` }))));
  const ifMatch = () => ({ 'If-Match': `W/"${o.version}"` });
  const actionLabel = (a: string) => t(`order.action.${a}` as any);

  async function act(action: string, body: any = {}) {
    busy = action;
    try {
      await api.post(`/orders/${o.id}/actions/${action}`, body, ifMatch());
      await load();
      toast.success(t('order.toast.action_done', { action: actionLabel(action) }));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        toast.warning(t('order.toast.changed_elsewhere'));
        await load();
      } else if (e instanceof ApiError && action === 'reserve' && e.code === 'exceeds_availability' && session.can('orders:overbook') && !body.overbook) {
        // Staff allowed to may book past stock on purpose, with a reason (FR-AV-8).
        overbook = { message: e.message, reason: '', error: '' };
      } else if (Object.keys(fieldErrors(e)).some((k) => k.startsWith('meter_readings['))) {
        const fe = fieldErrors(e);
        meterErrors = Object.fromEntries(meterOrder.map((sid, i) => [sid, fe[`meter_readings[${i}].value`] ?? fe[`meter_readings[${i}]`]]).filter(([, v]) => v));
      } else notifyError(e);
      return false;
    } finally {
      busy = '';
    }
  }

  let sigPad: ReturnType<typeof SignaturePad> | undefined = $state();
  let sigEmpty = $state(true);

  /** Pickup: a drawn signature is uploaded first and printed on the rental agreement. */
  async function checkOut() {
    let file_id: string | undefined;
    try {
      if (!sigEmpty && sigPad) {
        const blob = await sigPad.toBlob();
        if (blob) file_id = (await upload('/files?purpose=photo', blob, 'signature.png')).id;
      }
    } catch (e) {
      notifyError(e);
      return;
    }
    return act('check_out', { signature: sigName ? { name: sigName, method: file_id ? 'drawn' : 'click', file_id } : undefined, meter_readings: readings(pickupMeters) });
  }

  function runAction(a: any) {
    if (a.action === 'check_in') return openCheckIn();
    if (a.action === 'inspect') return openInspect();
    if (a.action === 'cancel') return (cancelOpen = true);
    if (a.action === 'check_out') return checkOut();
    return act(a.action);
  }

  /** Optional fees and the delivery postcode of a draft or quote order (FR-PR-8). */
  function setExtras(patch: { fees?: string[]; postcode?: string | null }) {
    return call(() => api.patch(`/orders/${o.id}`, { options: { ...o.options, ...patch } }), t('order.toast.extras_saved'));
  }

  async function call(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      await load();
      return true;
    } catch (e) {
      notifyError(e);
      return false;
    }
  }

  /** The refund the shop's cancellation tiers give right now (the cancel action uses the same rule). */
  async function openDecision(mode: 'approve' | 'decline') {
    let policyPct = 0;
    if (mode === 'approve') {
      const s = await api.get('/tenant/settings').catch(() => null);
      const hours = (new Date(o.starts_at).getTime() - Date.now()) / 3_600_000;
      const tier = [...(s?.cancellation_policy ?? [])].sort((a: any, b: any) => b.hours_before - a.hours_before).find((x: any) => hours >= x.hours_before);
      policyPct = tier?.refund_pct ?? 0;
    }
    decide = { mode, refund: String(policyPct), note: '', policyPct };
  }

  async function submitDecision(e: SubmitEvent) {
    e.preventDefault();
    if (!decide || !cancelReq) return;
    deciding = true;
    const body = decide.mode === 'approve' ? { refund_pct: Math.max(0, Math.min(100, Math.round(Number(decide.refund) || 0))), note: decide.note || undefined } : { note: decide.note || undefined };
    const ok = await call(() => api.post(`/cancellation_requests/${cancelReq.id}/actions/${decide!.mode}`, body), t(decide.mode === 'approve' ? 'cancellation.approved' : 'cancellation.declined'));
    deciding = false;
    if (ok) decide = null;
  }

  async function handleScan(code: string): Promise<boolean> {
    if (!o) return false;
    try {
      if (['reserved', 'prepared'].includes(o.status)) {
        await api.post(`/orders/${o.id}/actions/assign_units`, { barcodes: [code] });
        scanMsg = { ok: true, text: t('order.scan.assigned', { code }) };
      } else if (['out', 'returned_partial'].includes(o.status)) {
        await api.post(`/orders/${o.id}/actions/check_in`, { units: [{ barcode: code, outcome: 'ok' }] }, ifMatch());
        scanMsg = { ok: true, text: t('order.scan.checked_in', { code }) };
      } else return false;
      beep(true);
      await load();
    } catch (e) {
      beep(false);
      scanMsg = { ok: false, text: (e as Error).message };
    }
    return true;
  }

  async function submitScan(e: SubmitEvent) {
    e.preventDefault();
    if (!scanInput.trim()) return;
    await handleScan(scanInput.trim());
    scanInput = '';
  }

  function openCheckIn() {
    checkIn = {
      units: Object.fromEntries(allUnits.filter((u: any) => u.checked_out_at && !u.checked_in_at).map((u: any) => [u.stock_item_id, 'ok'])),
      bulk: Object.fromEntries(bulkLines.map((l: any) => [l.id, l.picked_up_qty - l.returned_qty - l.lost_qty])),
    };
    checkInOpen = true;
  }
  async function submitCheckIn() {
    const ok = await act('check_in', {
      units: Object.entries(checkIn.units).filter(([, v]) => v !== 'skip').map(([stock_item_id, outcome]) => ({ stock_item_id, outcome })),
      lines: Object.entries(checkIn.bulk).filter(([, n]) => Number(n) > 0).map(([line_id, returned]) => ({ line_id, returned: Number(returned) })),
      meter_readings: readings(allUnits.filter((u: any) => u.checked_out_at && !u.checked_in_at && checkIn.units[u.stock_item_id] !== 'skip')),
    });
    if (ok) checkInOpen = false;
  }

  function openInspect() {
    inspect = { units: Object.fromEntries(allUnits.filter((u: any) => u.check_in_outcome && !['ok', 'lost'].includes(u.check_in_outcome)).map((u: any) => [u.stock_item_id, 'available'])), charges: [] };
    inspectOpen = true;
  }
  async function submitInspect() {
    const ok = await act('inspect', {
      units: Object.entries(inspect.units).map(([stock_item_id, status]) => ({ stock_item_id, status })),
      damage_charges: inspect.charges.filter((c) => c.description && c.amount).map((c) => ({ description: c.description, amount: minorFromInput(c.amount) })),
    });
    if (ok) inspectOpen = false;
  }

  async function addLine() {
    if (!addPick) return;
    await call(() => api.post(`/orders/${o.id}/lines`, { variant_id: addPick, quantity: 1 }), t('order.toast.line_added'));
    addPick = '';
  }

  async function issuePickList() {
    try {
      const doc = await api.post(`/orders/${o.id}/documents`, { type: 'pick_list' });
      await openHtml(`/documents/${doc.id}/html`);
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function refund(p: any) {
    if (await confirmAction({ title: t('payment.refund_title'), description: t('payment.refund_description', { amount: formatMoney(p.amount) }), confirmLabel: t('payment.refund'), destructive: true })) {
      await call(() => api.post(`/payments/${p.id}/actions/refund`, {}), t('payment.toast.refunded'));
    }
  }
  async function releaseDeposit() {
    if (await confirmAction({ title: t('deposit.release_title'), description: t('deposit.release_description'), confirmLabel: t('deposit.release') })) {
      await call(() => api.post(`/deposits/${openDeposit.id}/actions/release`), t('deposit.toast.released'));
    }
  }
  /** The first download renders the PDF (a second or two); later ones come from storage. */
  async function openPdf(doc: any) {
    const id = toast.loading(t('document.pdf_rendering'));
    try {
      await openHtml(`/documents/${doc.id}/pdf`);
      toast.dismiss(id);
    } catch (e) {
      toast.dismiss(id);
      notifyError(e);
    }
  }

  async function voidInvoice(doc: any) {
    if (await confirmAction({ title: t('document.void_title'), description: t('document.void_description', { number: doc.number }), confirmLabel: t('document.void'), destructive: true })) {
      await call(() => api.post(`/documents/${doc.id}/actions/void`, { reason: t('document.void_reason') }), t('document.toast.voided'));
    }
  }

  function timelineText(ev: any) {
    const type = ev.type.replace(/_/g, ' ');
    if (ev.to_status && ev.from_status !== ev.to_status) return `${type}: ${ev.from_status ? t(`status.${ev.from_status}` as any) : t('common.new')} → ${t(`status.${ev.to_status}` as any)}`;
    const bits = [type];
    // Only money objects are shown; a bare number has no currency to format with.
    if (ev.payload?.amount?.currency) bits.push(formatMoney(ev.payload.amount));
    if (ev.payload?.number) bits.push(ev.payload.number);
    if (ev.payload?.recipient) bits.push(`${ev.payload.recipient} (${t(`status.${ev.payload.status}` as any)})`);
    if (ev.payload?.barcodes?.length) bits.push(ev.payload.barcodes.join(', '));
    return bits.join(' · ');
  }
</script>

<svelte:head><title>{o ? `#${o.number}` : t('nav.orders')} · OpenRent</title></svelte:head>

{#if o}
  <PageHeader title={t('order.title', { number: o.number })} description={o.customer?.name ?? t('order.walk_in')}>
    <StatusBadge status={o.status} label={t(`status.${o.status}` as any)} />
    <StatusBadge status={o.payment_status} label={t(`status.${o.payment_status}` as any)} />
    {#if o.fulfilment.overdue}<StatusBadge status="overdue" label={t('status.overdue')} />{/if}
    {#if o.source === 'storefront'}<Badge variant="secondary">{t('orders.online')}</Badge>{/if}
    {#snippet actions()}
      {#if endChangeable}
        <Button variant="outline" onclick={() => ((endChange = 'extend'), (endOpen = true))}>{t('end_change.extend')}</Button>
      {/if}
      {#if others.length || endChangeable}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}<Button variant="outline" size="icon" aria-label={t('common.more_actions')} {...props}><EllipsisIcon /></Button>{/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            {#each others as a (a.action)}
              <DropdownMenu.Item disabled={!a.enabled} variant={a.action === 'cancel' ? 'destructive' : 'default'} onSelect={() => runAction(a)}>
                {actionLabel(a.action)}
              </DropdownMenu.Item>
            {/each}
            {#if endChangeable}<DropdownMenu.Item onSelect={() => ((endChange = 'return_early'), (endOpen = true))}>{t('end_change.return_early')}</DropdownMenu.Item>{/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
      {#if primary}
        <Button disabled={!primary.enabled || !!busy} onclick={() => runAction(primary)}>{#if busy === primary.action}<Spinner />{/if}{actionLabel(primary.action)}</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <ExtensionRequestAlert order={o} ondecided={load} />
  <EndChangeDialog order={o} mode={endChange} bind:open={endOpen} ondone={load} />
  <SwapUnitDialog orderId={o.id} unit={swapping} bind:open={swapOpen} ondone={load} />
  <Dialog.Root open={!!overbook} onOpenChange={(v) => !v && (overbook = null)}>
    <Dialog.Content>
      {#if overbook}
        <form
          class="flex flex-col gap-4"
          onsubmit={async (e) => {
            e.preventDefault();
            if (!overbook!.reason.trim()) return (overbook!.error = t('overbook.reason_required'));
            if (await act('reserve', { overbook: { reason: overbook!.reason.trim() } })) overbook = null;
          }}
        >
          <Dialog.Header>
            <Dialog.Title>{t('overbook.title')}</Dialog.Title>
            <Dialog.Description>{overbook.message}. {t('overbook.hint')}</Dialog.Description>
          </Dialog.Header>
          <Field.Field data-invalid={!!overbook.error || undefined}>
            <Field.Label for="ob-reason">{t('overbook.reason')}</Field.Label>
            <Input id="ob-reason" bind:value={overbook.reason} aria-invalid={!!overbook.error} />
            {#if overbook.error}<Field.Error>{overbook.error}</Field.Error>{/if}
          </Field.Field>
          <Dialog.Footer>
            <Button type="button" variant="outline" onclick={() => (overbook = null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="destructive" disabled={!!busy}>{t('overbook.confirm')}</Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
  {#if o.overbookings?.length}
    <Alert.Root variant="destructive" class="mb-6" data-testid="order-overbooked">
      <MessageSquareWarningIcon />
      <Alert.Title>{t('overbook.banner', { count: o.overbookings.reduce((a: number, x: any) => a + x.quantity, 0) })}</Alert.Title>
      <Alert.Description>{o.overbookings.map((x: any) => x.reason).join(' · ')}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if cancelReq?.status === 'pending'}
    <Alert.Root class="mb-6 border-amber-500/40 bg-amber-50 dark:bg-amber-950" data-testid="cancellation-request">
      <MessageSquareWarningIcon />
      <Alert.Title>{t('cancellation.title')}</Alert.Title>
      <Alert.Description class="flex flex-col gap-3">
        <p>{t('cancellation.description', { when: rel(cancelReq.created_at), reason: cancelReq.reason || t('cancellation.no_reason') })}</p>
        {#if session.can('orders:write')}
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onclick={() => openDecision('approve')}>{t('cancellation.approve')}</Button>
            <Button size="sm" variant="outline" onclick={() => openDecision('decline')}>{t('cancellation.decline')}</Button>
          </div>
        {/if}
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if primary && !primary.enabled}
    <Alert.Root class="mb-6">
      <CircleAlertIcon />
      <Alert.Title>{t('order.blocked', { action: actionLabel(primary.action) })}</Alert.Title>
      <Alert.Description>{primary.blocked_reasons.map((b: any) => b.message).join(' · ')}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
    <div class="flex min-w-0 flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title>{t('order.items')}</Card.Title>
          <Card.Description>{t('order.items_hint')}</Card.Description>
          <Card.Action class="flex items-center gap-2">
            <Button variant="outline" size="sm" onclick={issuePickList}><ListChecksIcon />{t('order.pick_list')}</Button>
          </Card.Action>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          {#if ['reserved', 'prepared', 'out', 'returned_partial'].includes(o.status)}
            <form onsubmit={submitScan}>
              <InputGroup.Root>
                <InputGroup.Addon><ScanBarcodeIcon /></InputGroup.Addon>
                <InputGroup.Input placeholder={['out', 'returned_partial'].includes(o.status) ? t('order.scan.to_check_in') : t('order.scan.to_assign')} bind:value={scanInput} data-scan="1" aria-label={t('order.scan.barcode')} />
              </InputGroup.Root>
            </form>
            {#if scanMsg}
              <Alert.Root variant={scanMsg.ok ? 'default' : 'destructive'} role="status">
                {#if scanMsg.ok}<CircleCheckIcon />{:else}<CircleAlertIcon />{/if}
                <Alert.Title>{scanMsg.text}</Alert.Title>
              </Alert.Root>
            {/if}
          {/if}
          <div class="overflow-hidden rounded-lg border">
            <Table.Root>
              <Table.Header class="bg-muted/50">
                <Table.Row><Table.Head>{t('new_order.item')}</Table.Head><Table.Head class="w-28">{t('field.quantity')}</Table.Head><Table.Head class="text-right">{t('orders.col.total')}</Table.Head><Table.Head class="w-10"></Table.Head></Table.Row>
              </Table.Header>
              <Table.Body>
                {#each o.lines as l (l.id)}
                  <Table.Row>
                    <Table.Cell class="whitespace-normal">
                      <div class="font-medium">{l.description}</div>
                      <div class="text-xs text-muted-foreground">{t(`line.type.${l.type}` as any)}{periods(l.price_snapshot) ? ` · ${periods(l.price_snapshot)}` : ''}{l.type === 'discount' && l.price_snapshot?.percent_bp != null ? ` · ${(l.price_snapshot.percent_bp / 100).toLocaleString(getLocale())} %` : ''}{l.tracking === 'bulk' && l.picked_up_qty ? ` · ${t('order.bulk_progress', { out: l.picked_up_qty - l.returned_qty - l.lost_qty, returned: l.returned_qty })}` : ''}</div>
                      {#each l.components.length ? l.components : [l] as c (c.id)}
                        {#if c.tracking === 'serialized'}
                          <div class="mt-2 flex flex-wrap gap-1.5">
                            {#each c.units as u (u.stock_item_id)}
                              <Badge variant={u.checked_in_at ? 'secondary' : 'outline'} class={'font-mono ' + (u.checked_in_at ? 'line-through' : '')}>
                                {u.barcode}
                                {#if u.check_in_outcome && u.check_in_outcome !== 'ok'}<span class="text-amber-600">· {t(`checkin.outcome.${u.check_in_outcome}` as any)}</span>{/if}
                                {#if u.checked_out_at && !u.checked_in_at && ['out', 'returned_partial'].includes(o.status) && session.can('orders:fulfil')}
                                  <button class="-mr-1 rounded-sm opacity-60 hover:opacity-100" aria-label={t('swap.title', { code: u.barcode })} onclick={() => ((swapping = u), (swapOpen = true))}><ArrowLeftRightIcon class="size-3" /></button>
                                {/if}
                                {#if !u.checked_out_at && ['reserved', 'prepared'].includes(o.status)}
                                  <button class="-mr-1 rounded-sm opacity-60 hover:opacity-100" aria-label={t('order.unassign', { code: u.barcode })} onclick={() => call(() => api.post(`/orders/${o.id}/actions/unassign_units`, { stock_item_ids: [u.stock_item_id] }), t('order.toast.unassigned'))}><XIcon class="size-3" /></button>
                                {/if}
                              </Badge>
                            {/each}
                            {#each Array(Math.max(0, c.quantity - c.units.filter((u: any) => !u.replaced).length)) as _}
                              <Badge variant="outline" class="border-dashed border-amber-400 text-amber-700 dark:text-amber-400">{l.components.length ? c.description : t('order.unit')} · {t('order.not_assigned')}</Badge>
                            {/each}
                          </div>
                        {/if}
                      {/each}
                    </Table.Cell>
                    <Table.Cell>
                      {#if editable && l.type !== 'fee' && l.type !== 'discount'}
                        <Input type="number" min="1" value={l.quantity} class="w-20" aria-label={t('field.quantity')} onchange={(e) => call(() => api.patch(`/orders/${o.id}/lines/${l.id}`, { quantity: Number((e.target as HTMLInputElement).value) }), t('order.toast.quantity'))} />
                      {:else}<span class="tabular-nums">× {l.quantity}</span>{/if}
                    </Table.Cell>
                    <Table.Cell class="text-right align-top">{#if l.type === 'discount'}−<Money value={l.unit_price} />{:else}<Money value={l.total} />{/if}{#if l.discount.amount}<div class="text-xs text-muted-foreground">−<Money value={l.discount} /></div>{/if}</Table.Cell>
                    <Table.Cell class="align-top">{#if editable}<Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onclick={() => call(() => api.del(`/orders/${o.id}/lines/${l.id}`), t('order.toast.line_removed'))}><TrashIcon /></Button>{/if}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
          {#if editable}
            <div class="flex gap-2">
              <NativeSelect.Root class="flex-1" bind:value={addPick} aria-label={t('new_order.add_product')}><NativeSelect.Option value="">{t('new_order.add_product')}</NativeSelect.Option>{#each variantOptions as v (v.id)}<NativeSelect.Option value={v.id}>{v.label}</NativeSelect.Option>{/each}</NativeSelect.Root>
              <Button variant="outline" onclick={addLine} disabled={!addPick}><PlusIcon />{t('common.add')}</Button>
              <Button variant="outline" onclick={() => { discount = { description: '', mode: 'amount', value: '' }; discountErrors = {}; discountOpen = true; }}><PercentIcon />{t('order.add_discount')}</Button>
            </div>
            {#if o.totals.optional_fees.length}
              <Field.Set class="rounded-lg border p-3" data-testid="order-extras">
                <Field.Legend variant="label">{t('order.extras')}</Field.Legend>
                {#each o.totals.optional_fees as f (f.id)}
                  <Field.Field orientation="horizontal">
                    <Checkbox id={`ox-${f.id}`} checked={f.selected} onCheckedChange={(v) => setExtras({ fees: v === true ? [...(o.options.fees ?? []), f.id] : (o.options.fees ?? []).filter((x: string) => x !== f.id) })} />
                    <Field.Label for={`ox-${f.id}`} class="flex-1 justify-between font-normal">{f.name}<span class="text-muted-foreground tabular-nums">{#if f.kind === 'delivery' && !f.amount.amount}{t('order.extras_by_postcode')}{:else}<Money value={f.amount} />{/if}</span></Field.Label>
                  </Field.Field>
                {/each}
                {#if o.totals.optional_fees.some((f: any) => f.kind === 'delivery')}
                  <Field.Field data-invalid={!!o.totals.fee_errors.length || undefined}>
                    <Field.Label for="ox-postcode">{t('order.extras_postcode')}</Field.Label>
                    <Input id="ox-postcode" class="w-40" value={o.options.postcode ?? ''} onchange={(e) => setExtras({ postcode: (e.currentTarget as HTMLInputElement).value.trim() || null })} aria-invalid={!!o.totals.fee_errors.length} />
                    {#if o.totals.fee_errors.length}<Field.Error>{t(`order.extras_${o.totals.fee_errors[0].reason}` as any)}</Field.Error>{/if}
                  </Field.Field>
                {/if}
              </Field.Set>
            {/if}
          {/if}
        </Card.Content>
        {#if ['reserved', 'prepared'].includes(o.status)}
          <Card.Footer class="grid gap-4 border-t sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="sig">{t('order.signature')}</Field.Label>
              <Input id="sig" bind:value={sigName} />
              <Field.Description>{t('order.signature_hint')}</Field.Description>
            </Field.Field>
            <SignaturePad bind:this={sigPad} bind:empty={sigEmpty} label={t('scan.signature_pad')} clearLabel={t('scan.signature_clear')} undoLabel={t('scan.signature_undo')} />
            {#each pickupMeters as u (u.stock_item_id)}
              <Field.Field data-invalid={!!meterErrors[u.stock_item_id] || undefined}>
                <Field.Label for={`meter-out-${u.stock_item_id}`}>{t('meter.at_pickup', { code: u.barcode, unit: u.meter_unit })}</Field.Label>
                <Input id={`meter-out-${u.stock_item_id}`} type="number" min="0" step="any" class="w-40" placeholder={u.meter_value == null ? '' : String(u.meter_value)} bind:value={meters[u.stock_item_id]} aria-invalid={!!meterErrors[u.stock_item_id]} />
                {#if meterErrors[u.stock_item_id]}<Field.Error>{meterErrors[u.stock_item_id]}</Field.Error>{/if}
              </Field.Field>
            {/each}
          </Card.Footer>
        {/if}
      </Card.Root>

      <Tabs.Root bind:value={tab}>
        <Tabs.List>
          <Tabs.Trigger value="payments">{t('order.tab.payments')}</Tabs.Trigger>
          <Tabs.Trigger value="damage">{t('order.tab.damage')}</Tabs.Trigger>
          <Tabs.Trigger value="activity">{t('order.tab.activity')}</Tabs.Trigger>
          <Tabs.Trigger value="messages">{t('order.tab.messages')}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="payments">
          <Card.Root>
            <Card.Header>
              <Card.Title>{t('order.tab.payments')}</Card.Title>
              <Card.Action class="flex gap-2">
                {#if o.totals.balance.amount > 0 && session.can('payments:write') && !['cancelled', 'expired', 'closed'].includes(o.status)}
                  <Button size="sm" variant="outline" onclick={() => { requestForm = { amount: majorFromMinor(o.totals.balance.amount), message: '', notify: !!o.customer?.email }; requestOpen = true; }}><SendIcon />{t('payment_request.new')}</Button>
                {/if}
                <Button size="sm" variant="outline" onclick={() => { pay = { amount: majorFromMinor(o.totals.balance.amount), method: 'cash', purpose: 'rental' }; payOpen = true; }}><PlusIcon />{t('payment.record')}</Button>
              </Card.Action>
            </Card.Header>
            <Card.Content class="flex flex-col gap-4">
              {#each o.payment_requests.filter((r: any) => r.status === 'open') as r (r.id)}
                <Alert.Root data-testid="payment-request">
                  <SendIcon />
                  <Alert.Title>{t('payment_request.open', { amount: formatMoney(r.amount) })}</Alert.Title>
                  <Alert.Description class="flex flex-wrap items-center gap-2">
                    {#if r.message}<span>{r.message}</span>{/if}
                    <Button size="sm" variant="link" class="h-auto px-0" onclick={() => navigator.clipboard.writeText(r.url ?? o.public_url).then(() => toast.success(t('common.copied')))}><CopyIcon />{t('payment_request.copy_link')}</Button>
                    <Button size="sm" variant="link" class="text-destructive h-auto px-0" onclick={() => call(() => api.post(`/orders/${o.id}/payment_requests/${r.id}/actions/cancel`), t('payment_request.cancelled'))}>{t('payment_request.cancel')}</Button>
                  </Alert.Description>
                </Alert.Root>
              {/each}
              {#if o.payments.length}
                <Table.Root>
                  <Table.Body>
                    {#each o.payments as p (p.id)}
                      <Table.Row>
                        <Table.Cell class="text-muted-foreground">{dt(p.created_at)}</Table.Cell>
                        <Table.Cell>{p.kind === 'refund' ? t('payment.refund') : t(`payment.purpose.${p.purpose}` as any)} · {t(`payment.method.${p.method}` as any)}</Table.Cell>
                        <Table.Cell><StatusBadge status={p.status} label={t(`status.${p.status}` as any)} /></Table.Cell>
                        <Table.Cell class="text-right">{p.kind === 'refund' ? '−' : ''}<Money value={p.amount} /></Table.Cell>
                        <Table.Cell class="w-24 text-right">{#if p.kind !== 'refund' && p.status === 'succeeded' && session.can('payments:refund')}<Button variant="ghost" size="sm" onclick={() => refund(p)}>{t('payment.refund')}</Button>{/if}</Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              {:else}<p class="text-sm text-muted-foreground">{t('payment.none')}</p>{/if}
            </Card.Content>
          </Card.Root>
        </Tabs.Content>
        <Tabs.Content value="damage">
          <Card.Root>
            <Card.Header>
              <Card.Title>{t('order.tab.damage')}</Card.Title>
              <Card.Action><Button size="sm" variant="outline" onclick={() => { damage = { description: '', amount: '' }; damageOpen = true; }}><PlusIcon />{t('damage.add')}</Button></Card.Action>
            </Card.Header>
            <Card.Content>
              {#if o.damage_charges.length}
                <Table.Root>
                  <Table.Body>
                    {#each o.damage_charges as dmg (dmg.id)}
                      <Table.Row>
                        <Table.Cell class="whitespace-normal"><div class="mb-2 font-medium">{dmg.description}</div><PhotoStrip photos={dmg.photos} attachPath={`/damage_charges/${dmg.id}/photos`} onadded={load} /></Table.Cell>
                        <Table.Cell><StatusBadge status={dmg.status} label={t(`status.${dmg.status}` as any)} /></Table.Cell>
                        <Table.Cell class="text-right">
                          <Money value={dmg.amount} />
                          {#if dmg.covered_amount.amount}<div class="text-muted-foreground text-xs">{t('damage.waiver_covers')} <Money value={dmg.covered_amount} /></div>{/if}
                        </Table.Cell>
                        <Table.Cell class="text-right">
                          {#if dmg.status === 'open'}
                            <Button variant="ghost" size="sm" onclick={() => call(() => api.post(`/damage_charges/${dmg.id}/actions/invoice`), t('damage.toast.invoiced'))}>{t('damage.invoice')}</Button>
                            <Button variant="ghost" size="sm" onclick={() => call(() => api.post(`/damage_charges/${dmg.id}/actions/waive`), t('damage.toast.waived'))}>{t('damage.waive')}</Button>
                          {/if}
                        </Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              {:else}<p class="text-sm text-muted-foreground">{t('damage.none')}</p>{/if}
            </Card.Content>
          </Card.Root>
        </Tabs.Content>
        <Tabs.Content value="activity">
          <Card.Root>
            <Card.Content>
              <ol class="relative ml-2 border-l">
                {#each [...timeline].reverse() as ev (ev.id)}
                  <li class="mb-4 ml-4 last:mb-0">
                    <span class="absolute -left-1.5 mt-1.5 size-3 rounded-full border bg-background"></span>
                    <p class="text-sm">{timelineText(ev)}</p>
                    <p class="text-xs text-muted-foreground" title={dt(ev.at)}>{t(`timeline.kind.${ev.kind}` as any)} · {rel(ev.at)}</p>
                  </li>
                {/each}
              </ol>
            </Card.Content>
          </Card.Root>
        </Tabs.Content>
        <Tabs.Content value="messages">
          <Card.Root>
            <Card.Content class="flex flex-col gap-3">
              {#each o.notifications as n (n.id)}
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0"><p class="truncate text-sm font-medium">{n.subject}</p><p class="text-xs text-muted-foreground">{n.recipient} · {rel(n.created_at)}</p></div>
                  <StatusBadge status={n.status} label={t(`status.${n.status}` as any)} />
                </div>
              {:else}<p class="text-sm text-muted-foreground">{t('message.none')}</p>{/each}
            </Card.Content>
          </Card.Root>
        </Tabs.Content>
      </Tabs.Root>
    </div>

    <div class="flex flex-col gap-6">
      <Card.Root>
        <Card.Header><Card.Title>{t('new_order.customer')}</Card.Title></Card.Header>
        <Card.Content class="text-sm">
          {#if o.customer}
            <a href={to(`/customers/${o.customer.id}`)} class="font-medium hover:underline">{o.customer.name}</a>
            <p class="text-muted-foreground">{o.customer.email ?? ''}</p>
            <p class="text-muted-foreground">{o.customer.phone ?? ''}</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#if o.customer.flags?.blocked}<StatusBadge status="blocked" label={t('customer.flag.blocked')} />{/if}
              {#if o.customer.flags?.deposit_waived}<Badge variant="secondary">{t('customer.flag.deposit_waived')}</Badge>{/if}
              {#if o.customer.flags?.requires_id_check}<Badge variant="secondary">{t('customer.flag.id_check')}</Badge>{/if}
            </div>
          {:else}<p class="text-muted-foreground">{t('order.no_customer')}</p>{/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>{t('new_order.period')}</Card.Title>
          {#if editable}<Card.Action><Button variant="ghost" size="icon-sm" aria-label={t('common.edit')} onclick={() => { dates = { starts: toLocalInput(o.starts_at, o.timezone), ends: toLocalInput(o.ends_at, o.timezone) }; datesOpen = true; }}><PencilIcon /></Button></Card.Action>{/if}
        </Card.Header>
        <Card.Content>
          <dl class="grid gap-3 text-sm">
            <div><dt class="text-xs text-muted-foreground">{t('field.pickup')}</dt><dd>{dt(o.starts_at, o.timezone)}</dd></div>
            <div><dt class="text-xs text-muted-foreground">{t('field.return')}</dt><dd>{dt(o.ends_at, o.timezone)} <span class="text-xs text-muted-foreground">({rel(o.ends_at)})</span></dd></div>
            {#if !session.singleLocation}<div><dt class="text-xs text-muted-foreground">{t('field.location')}</dt><dd>{o.location?.name}</dd></div>{/if}
            {#if o.quote_expires_at}<div><dt class="text-xs text-muted-foreground">{t('order.quote_expires')}</dt><dd>{dt(o.quote_expires_at)}</dd></div>{/if}
          </dl>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>{t('order.totals')}</Card.Title></Card.Header>
        <Card.Content>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-muted-foreground">{t('price.subtotal')}</dt><dd><Money value={o.totals.subtotal} /></dd></div>
            {#if o.totals.discount.amount}<div class="flex justify-between"><dt class="text-muted-foreground">{t('price.discount')}</dt><dd>−<Money value={o.totals.discount} /></dd></div>{/if}
            {#if o.totals.fees.amount}<div class="flex justify-between"><dt class="text-muted-foreground">{t('price.fees')}</dt><dd><Money value={o.totals.fees} /></dd></div>{/if}
            <div class="flex justify-between"><dt class="text-muted-foreground">{t('price.tax')}</dt><dd><Money value={o.totals.tax} /></dd></div>
            <Separator />
            <div class="flex justify-between font-semibold"><dt>{t('price.total')}</dt><dd><Money value={o.totals.total} /></dd></div>
            <div class="flex justify-between"><dt class="text-muted-foreground">{t('price.paid')}</dt><dd><Money value={o.totals.paid} /></dd></div>
            <div class={'flex justify-between font-medium ' + (o.totals.balance.amount > 0 ? 'text-destructive' : '')}><dt>{t('price.balance')}</dt><dd><Money value={o.totals.balance} /></dd></div>
          </dl>
          {#each o.totals.coupons_applied as c}<Badge variant="secondary" class="mt-3">{t('field.coupon')}: {c.code}</Badge>{/each}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>{t('deposit.title')}</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-3 text-sm">
          {#each o.deposits as dep (dep.id)}
            <div class="flex items-center justify-between"><span><Money value={dep.amount} /> · {t(`deposit.method.${dep.method}` as any)}</span><StatusBadge status={dep.status} label={t(`status.${dep.status}` as any)} /></div>
            {#if dep.expires_at && dep.status === 'held'}<p class="text-xs text-muted-foreground">{t('deposit.expires', { when: dt(dep.expires_at) })}</p>{/if}
            {#if dep.captured_amount.amount}<p class="text-xs">{t('deposit.captured')}: <Money value={dep.captured_amount} /></p>{/if}
          {:else}
            <p class="text-muted-foreground">{o.totals.deposit.amount ? t('deposit.created_on_reserve') : t('deposit.none')}</p>
          {/each}
        </Card.Content>
        {#if openDeposit}
          <Card.Footer class="flex flex-wrap gap-2 border-t">
            {#if ['pending', 'failed', 'expired'].includes(openDeposit.status)}
              <Button size="sm" variant="outline" onclick={() => call(() => api.post(`/deposits/${openDeposit.id}/actions/authorize`, { method: 'cash' }), t('deposit.toast.cash'))}>{t('deposit.take_cash')}</Button>
              {#if openDeposit.method === 'card_auth'}<Button size="sm" variant="outline" onclick={() => call(() => api.post(`/deposits/${openDeposit.id}/actions/authorize`, { method: 'card_auth' }), t('deposit.toast.card'))}>{t('deposit.hold_card')}</Button>{/if}
              <Button size="sm" variant="outline" onclick={() => call(() => api.post(`/deposits/${openDeposit.id}/actions/authorize`, { method: 'charge', via: 'provider' }), t('deposit.toast.charged'))}>{t('deposit.charge_card')}</Button>
            {/if}
            {#if openDeposit.status === 'held'}
              <Button size="sm" variant="outline" onclick={() => { capture = { amount: majorFromMinor(o.damage_charges.filter((x: any) => x.status === 'open').reduce((a: number, x: any) => a + x.amount.amount, 0) || openDeposit.amount.amount), reason: t('deposit.default_reason') }; captureDeposit = openDeposit; captureOpen = true; }}>{t('deposit.capture')}</Button>
              <Button size="sm" variant="outline" onclick={releaseDeposit}>{t('deposit.release')}</Button>
            {/if}
          </Card.Footer>
        {/if}
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title>{t('document.title')}</Card.Title>
          <Card.Action>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>{#snippet child({ props })}<Button size="sm" variant="outline" {...props}><PlusIcon />{t('document.issue')}</Button>{/snippet}</DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                {#each ['quote', 'confirmation', 'contract', 'invoice', 'receipt', 'delivery_note'] as dtype}
                  <DropdownMenu.Item onSelect={() => call(() => api.post(`/orders/${o.id}/documents`, { type: dtype }), t('document.toast.issued', { type: t(`document.type.${dtype}` as any) }))}>{t(`document.type.${dtype}` as any)}</DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Card.Action>
        </Card.Header>
        <Card.Content class="flex flex-col gap-1">
          {#each o.documents as doc (doc.id)}
            <div class="flex min-w-0 items-center gap-1">
              <Button variant="ghost" size="sm" class="min-w-0 flex-1 justify-start" title={`${t(`document.type.${doc.type}` as any)} ${doc.number ?? ''}`} onclick={() => openHtml(`/documents/${doc.id}/html`).catch(notifyError)}><FileTextIcon /><span class="truncate">{t(`document.type.${doc.type}` as any)} {doc.number}</span></Button>
              <StatusBadge status={doc.status} label={t(`status.${doc.status}` as any)} />
              <Button variant="ghost" size="icon-sm" aria-label={t('document.pdf')} title={t('document.pdf')} onclick={() => openPdf(doc)}><FileDownIcon /></Button>
              {#if o.customer?.email && ['quote', 'confirmation', 'invoice', 'contract', 'receipt'].includes(doc.type) && doc.status !== 'voided'}
                <Button variant="ghost" size="icon-sm" aria-label={t('document.send')} title={t('document.send')} onclick={() => call(() => api.post(`/documents/${doc.id}/actions/send`), t('document.toast.sent', { email: o.customer.email }))}><SendIcon /></Button>
              {/if}
              {#if doc.type === 'invoice' && doc.status !== 'voided'}<Button variant="ghost" size="sm" onclick={() => voidInvoice(doc)}>{t('document.void')}</Button>{/if}
            </div>
          {:else}<p class="text-sm text-muted-foreground">{t('document.none')}</p>{/each}
        </Card.Content>
      </Card.Root>
      <DeliveriesCard order={o} onchange={load} />
      <AttachmentsCard ownerPath={`/orders/${o.id}`} shareable />

      <Card.Root>
        <Card.Header><Card.Title>{t('order.notes')}</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-3">
          <Field.Field>
            <Field.Label for="ni">{t('order.notes_internal')}</Field.Label>
            <Textarea id="ni" value={o.notes?.internal ?? ''} onchange={(e) => call(() => api.patch(`/orders/${o.id}`, { notes: { internal: (e.target as HTMLTextAreaElement).value } }), t('order.toast.note_saved'))} />
          </Field.Field>
          {#if o.notes?.customer}<p class="text-sm"><span class="text-xs text-muted-foreground">{t('order.notes_customer')}:</span> {o.notes.customer}</p>{/if}
          <Field.Field>
            <Field.Label for="otags">{t('field.tags')}</Field.Label>
            <TagInput id="otags" entity="order" value={o.tags} onchange={(tags) => call(() => api.patch(`/orders/${o.id}`, { tags }), t('common.saved'))} />
          </Field.Field>
          {#if extras}
            <form class="flex flex-col gap-3" onsubmit={saveExtras}>
              <CustomFieldsForm entity="order" bind:value={extras} errors={extrasErrors} />
              <div><Button type="submit" size="sm" variant="outline">{t('common.save')}</Button></div>
            </form>
          {/if}
        </Card.Content>
      </Card.Root>
      <PluginSlot slot="order.sidebar" context={{ order_id: o.id }} />
    </div>
  </div>

  <Dialog.Root bind:open={checkInOpen}>
    <Dialog.Content class="sm:max-w-2xl">
      <Dialog.Header><Dialog.Title>{t('checkin.title')}</Dialog.Title><Dialog.Description>{t('checkin.description')}</Dialog.Description></Dialog.Header>
      <div class="flex flex-col gap-4">
        {#if Object.keys(checkIn.units).length}
          <div class="overflow-hidden rounded-lg border">
            <Table.Root>
              <Table.Header class="bg-muted/50"><Table.Row><Table.Head>{t('checkin.unit')}</Table.Head><Table.Head>{t('new_order.item')}</Table.Head><Table.Head>{t('checkin.outcome')}</Table.Head>{#if allUnits.some((u: any) => u.meter_unit)}<Table.Head>{t('meter.title')}</Table.Head>{/if}</Table.Row></Table.Header>
              <Table.Body>
                {#each allUnits.filter((u: any) => u.checked_out_at && !u.checked_in_at) as u (u.stock_item_id)}
                  <Table.Row>
                    <Table.Cell class="font-mono text-xs">{u.barcode}</Table.Cell>
                    <Table.Cell>{u.line}</Table.Cell>
                    <Table.Cell>
                      <NativeSelect.Root size="sm" bind:value={checkIn.units[u.stock_item_id]} aria-label={t('checkin.outcome')}>
                        {#each ['ok', 'needs_inspection', 'damaged', 'lost', 'skip'] as oc}<NativeSelect.Option value={oc}>{t(`checkin.outcome.${oc}` as any)}</NativeSelect.Option>{/each}
                      </NativeSelect.Root>
                    </Table.Cell>
                    {#if allUnits.some((x: any) => x.meter_unit)}
                      <Table.Cell>
                        {#if u.meter_unit}
                          <Input type="number" min="0" step="any" class="w-28" placeholder={u.meter_value == null ? u.meter_unit : String(u.meter_value)} bind:value={meters[u.stock_item_id]} aria-label={t('meter.at_return', { code: u.barcode, unit: u.meter_unit })} aria-invalid={!!meterErrors[u.stock_item_id]} />
                          {#if meterErrors[u.stock_item_id]}<p class="text-destructive mt-1 text-xs">{meterErrors[u.stock_item_id]}</p>{/if}
                        {/if}
                      </Table.Cell>
                    {/if}
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        {/if}
        {#each bulkLines as l (l.id)}
          <Field.Field orientation="horizontal">
            <Field.Label for={`bulk-${l.id}`} class="flex-1">{l.description} <span class="text-muted-foreground">({t('checkin.out_count', { count: l.picked_up_qty - l.returned_qty - l.lost_qty })})</span></Field.Label>
            <Input id={`bulk-${l.id}`} type="number" min="0" class="w-24" bind:value={checkIn.bulk[l.id]} />
          </Field.Field>
        {/each}
        {#if new Date(o.ends_at) < new Date()}<Alert.Root><CircleAlertIcon /><Alert.Title>{t('checkin.late')}</Alert.Title></Alert.Root>{/if}
      </div>
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button disabled={busy === 'check_in'} onclick={submitCheckIn}>{#if busy === 'check_in'}<Spinner />{/if}{t('order.action.check_in')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={inspectOpen}>
    <Dialog.Content class="sm:max-w-2xl">
      <Dialog.Header><Dialog.Title>{t('inspect.title')}</Dialog.Title><Dialog.Description>{t('inspect.description')}</Dialog.Description></Dialog.Header>
      <Field.Group>
        {#each Object.keys(inspect.units) as sid (sid)}
          {@const u = allUnits.find((x: any) => x.stock_item_id === sid)}
          <Field.Field orientation="horizontal">
            <Field.Label for={`ins-${sid}`} class="flex-1"><span class="font-mono text-xs">{u?.barcode}</span> {u?.line} · {t(`checkin.outcome.${u?.check_in_outcome}` as any)}</Field.Label>
            <NativeSelect.Root id={`ins-${sid}`} bind:value={inspect.units[sid]}>
              {#each ['available', 'soft_down', 'hard_down', 'retired'] as s}<NativeSelect.Option value={s}>{t(`inspect.result.${s}` as any)}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          </Field.Field>
        {:else}<p class="text-sm text-muted-foreground">{t('inspect.all_ok')}</p>{/each}
        <!-- Checklists (FR-MNT-3): a unit that ran one gets its status from the result. -->
        {#each allUnits.filter((u: any) => u.check_in_outcome && u.check_in_outcome !== 'lost') as u (u.stock_item_id)}
          <div class="flex items-center justify-between gap-2 text-sm empty:hidden" data-testid="inspect-checklist">
            <InspectionRunner stockItemId={u.stock_item_id} barcode={u.barcode} orderId={o.id} ondone={() => delete inspect.units[u.stock_item_id]} />
          </div>
        {/each}
        <Field.Separator />
        <Field.Set>
          <Field.Legend variant="label">{t('order.tab.damage')}</Field.Legend>
          {#each inspect.charges as c, i}
            <div class="flex gap-2">
              <Input placeholder={t('field.description')} bind:value={c.description} aria-label={t('field.description')} />
              <Input class="w-32" placeholder={t('field.amount')} inputmode="decimal" bind:value={c.amount} aria-label={t('field.amount')} />
              <Button variant="ghost" size="icon" aria-label={t('common.remove')} onclick={() => inspect.charges.splice(i, 1)}><TrashIcon /></Button>
            </div>
          {/each}
          <Button variant="outline" size="sm" class="w-fit" onclick={() => inspect.charges.push({ description: '', amount: '' })}><PlusIcon />{t('damage.add')}</Button>
        </Field.Set>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button disabled={busy === 'inspect'} onclick={submitInspect}>{t('order.action.inspect')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={cancelOpen}>
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>{t('cancel.title', { number: o.number })}</Dialog.Title><Dialog.Description>{t('cancel.description')}</Dialog.Description></Dialog.Header>
      <Field.Group>
        <Field.Field><Field.Label for="cr">{t('cancel.reason')}</Field.Label><Input id="cr" bind:value={cancel.reason} /></Field.Field>
        <Field.Field orientation="horizontal"><Checkbox id="crf" bind:checked={cancel.refund} /><Field.Label for="crf" class="font-normal">{t('cancel.refund')}</Field.Label></Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('cancel.keep')}</Button>{/snippet}</Dialog.Close>
        <Button variant="destructive" disabled={busy === 'cancel'} onclick={async () => { if (await act('cancel', cancel)) cancelOpen = false; }}>{t('order.action.cancel')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={discountOpen}>
    <Dialog.Content>
      <form class="flex flex-col gap-4" onsubmit={addDiscount}>
        <Dialog.Header>
          <Dialog.Title>{t('order.add_discount')}</Dialog.Title>
          <Dialog.Description>{t('order.discount_hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          <Field.Field>
            <Field.Label for="dc-desc">{t('field.description')}</Field.Label>
            <Input id="dc-desc" maxlength={200} placeholder={t('order.discount_placeholder')} bind:value={discount.description} />
          </Field.Field>
          <Field.Field data-invalid={!!discountErrors.value || undefined}>
            <Field.Label for="dc-value">{discount.mode === 'percent' ? t('order.discount_percent') : `${t('field.amount')} (${session.currency})`}</Field.Label>
            <div class="flex gap-2">
              <ToggleGroup.Root type="single" variant="outline" bind:value={discount.mode} aria-label={t('order.discount_kind')}>
                <ToggleGroup.Item value="amount">{session.currency}</ToggleGroup.Item>
                <ToggleGroup.Item value="percent">%</ToggleGroup.Item>
              </ToggleGroup.Root>
              <Input id="dc-value" inputmode="decimal" class="w-32" required bind:value={discount.value} aria-invalid={!!discountErrors.value} />
            </div>
            {#if discountErrors.value}<Field.Error>{discountErrors.value}</Field.Error>{/if}
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
          <Button type="submit">{t('order.add_discount')}</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={requestOpen}>
    <Dialog.Content>
      <form class="flex flex-col gap-4" onsubmit={sendRequest}>
        <Dialog.Header>
          <Dialog.Title>{t('payment_request.new')}</Dialog.Title>
          <Dialog.Description>{t('payment_request.hint')}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          <Field.Field data-invalid={!!requestErrors.amount || undefined}>
            <Field.Label for="pr-amount">{t('field.amount')} ({session.currency})</Field.Label>
            <Input id="pr-amount" inputmode="decimal" class="w-40" bind:value={requestForm.amount} aria-invalid={!!requestErrors.amount} />
            {#if requestErrors.amount}<Field.Error>{requestErrors.amount}</Field.Error>{:else}<Field.Description>{t('payment_request.balance', { amount: formatMoney(o.totals.balance) })}</Field.Description>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="pr-msg">{t('payment_request.message')}</Field.Label>
            <Textarea id="pr-msg" maxlength={1000} bind:value={requestForm.message} />
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Checkbox id="pr-notify" bind:checked={requestForm.notify} disabled={!o.customer?.email} />
            <Field.Label for="pr-notify" class="font-normal">{o.customer?.email ? t('payment_request.notify', { email: o.customer.email }) : t('payment_request.no_email')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <Dialog.Footer>
          <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
          <Button type="submit"><SendIcon />{requestForm.notify ? t('payment_request.send') : t('payment_request.create_copy')}</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={payOpen}>
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>{t('payment.record')}</Dialog.Title><Dialog.Description>{t('payment.record_description')}</Dialog.Description></Dialog.Header>
      <Field.Group class="grid gap-4 sm:grid-cols-3">
        <Field.Field><Field.Label for="pa">{t('field.amount')} ({session.currency})</Field.Label><Input id="pa" inputmode="decimal" bind:value={pay.amount} /></Field.Field>
        <Field.Field><Field.Label for="pm">{t('payment.method_label')}</Field.Label><NativeSelect.Root id="pm" class="w-full" bind:value={pay.method}>{#each ['cash', 'card_terminal', 'bank_transfer', 'other'] as m}<NativeSelect.Option value={m}>{t(`payment.method.${m}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
        <Field.Field><Field.Label for="pp">{t('payment.for')}</Field.Label><NativeSelect.Root id="pp" class="w-full" bind:value={pay.purpose}>{#each ['rental', 'damage', 'late_fee'] as p}<NativeSelect.Option value={p}>{t(`payment.purpose.${p}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button onclick={async () => { if (await call(() => api.post(`/orders/${o.id}/payments`, { amount: minorFromInput(pay.amount), method: pay.method, purpose: pay.purpose }), t('payment.toast.recorded'))) payOpen = false; }}>{t('payment.record')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={captureOpen}>
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>{t('deposit.capture_title')}</Dialog.Title><Dialog.Description>{t('deposit.capture_description')}</Dialog.Description></Dialog.Header>
      <Field.Group>
        <Field.Field><Field.Label for="ca">{t('field.amount')} ({session.currency})</Field.Label><Input id="ca" inputmode="decimal" bind:value={capture.amount} /></Field.Field>
        <Field.Field><Field.Label for="crs">{t('cancel.reason')}</Field.Label><Input id="crs" bind:value={capture.reason} /></Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button variant="destructive" onclick={async () => { if (await call(() => api.post(`/deposits/${captureDeposit.id}/actions/capture`, { amount: minorFromInput(capture.amount), reason: capture.reason, damage_charge_ids: o.damage_charges.filter((x: any) => x.status === 'open').map((x: any) => x.id) }), t('deposit.toast.captured'))) captureOpen = false; }}>{t('deposit.capture')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={damageOpen}>
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>{t('damage.add')}</Dialog.Title><Dialog.Description>{t('damage.add_description')}</Dialog.Description></Dialog.Header>
      <Field.Group>
        <Field.Field><Field.Label for="dd">{t('field.description')}</Field.Label><Input id="dd" bind:value={damage.description} /></Field.Field>
        <Field.Field><Field.Label for="da">{t('field.amount')} ({session.currency})</Field.Label><Input id="da" inputmode="decimal" bind:value={damage.amount} /></Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button onclick={async () => { if (await call(() => api.post(`/orders/${o.id}/damage_charges`, { description: damage.description, amount: minorFromInput(damage.amount) }), t('damage.toast.added'))) damageOpen = false; }}>{t('common.add')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={datesOpen}>
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>{t('order.change_dates')}</Dialog.Title><Dialog.Description>{t('common.timezone_note', { tz: o.timezone })}</Dialog.Description></Dialog.Header>
      <Field.Group class="grid gap-4 sm:grid-cols-2">
        <Field.Field><Field.Label for="ds">{t('field.pickup')}</Field.Label><Input id="ds" type="datetime-local" bind:value={dates.starts} /></Field.Field>
        <Field.Field><Field.Label for="de">{t('field.return')}</Field.Label><Input id="de" type="datetime-local" bind:value={dates.ends} /></Field.Field>
      </Field.Group>
      <Dialog.Footer>
        <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
        <Button onclick={async () => { if (await call(() => api.patch(`/orders/${o.id}`, { starts_at: fromLocalInput(dates.starts, o.timezone), ends_at: fromLocalInput(dates.ends, o.timezone) }, ifMatch()), t('order.toast.dates'))) datesOpen = false; }}>{t('common.save')}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root open={!!decide} onOpenChange={(v) => !v && (decide = null)}>
    <Dialog.Content>
      {#if decide}
        <form class="flex flex-col gap-4" onsubmit={submitDecision}>
          <Dialog.Header>
            <Dialog.Title>{t(decide.mode === 'approve' ? 'cancellation.approve_title' : 'cancellation.decline_title')}</Dialog.Title>
            <Dialog.Description>{decide.mode === 'approve' ? t('cancellation.approve_hint', { pct: decide.policyPct }) : t('cancellation.decline_hint')}</Dialog.Description>
          </Dialog.Header>
          {#if decide.mode === 'approve'}
            <Field.Field>
              <Field.Label for="cr-refund">{t('cancellation.refund_pct')}</Field.Label>
              <Input id="cr-refund" type="number" min={0} max={100} class="w-28" bind:value={decide.refund} />
            </Field.Field>
          {/if}
          <Field.Field>
            <Field.Label for="cr-note">{t('cancellation.note')}</Field.Label>
            <Textarea id="cr-note" maxlength={1000} bind:value={decide.note} />
          </Field.Field>
          <Dialog.Footer>
            <Button type="button" variant="outline" onclick={() => (decide = null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant={decide.mode === 'approve' ? 'destructive' : 'default'} disabled={deciding}>{#if deciding}<Spinner />{/if}{t(decide.mode === 'approve' ? 'cancellation.approve' : 'cancellation.decline')}</Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <Skeleton class="mb-6 h-10 w-72" />
  <div class="grid gap-6 lg:grid-cols-[1fr_360px]"><Skeleton class="h-96 rounded-xl" /><Skeleton class="h-96 rounded-xl" /></div>
{/if}
