<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Item from '@openrent/ui/item';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import * as InputGroup from '@openrent/ui/input-group';
  import * as Empty from '@openrent/ui/empty';
  import * as Field from '@openrent/ui/field';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Table from '@openrent/ui/table';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Button } from '@openrent/ui/button';
  import { Input } from '@openrent/ui/input';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Spinner } from '@openrent/ui/spinner';
  import { StatusBadge, PageHeader, SignaturePad } from '@openrent/ui/openrent';
  import ScanBarcodeIcon from '@lucide/svelte/icons/scan-barcode';
  import CameraIcon from '@lucide/svelte/icons/camera';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import XIcon from '@lucide/svelte/icons/x';
  import { api, qs, upload, session, t, toast, notifyError, confirmAction } from '#lib';
  import { to, setScanHandler } from '#lib/nav.ts';
  import { beep } from '#lib/scanner.ts';
  import { createDetector } from '#lib/barcode.ts';
  import ScannerSetup from '#lib/components/scanner-setup.svelte';
  import PluginSlot from '#lib/components/plugin-slot.svelte';
  import InspectionRunner from '#lib/components/inspection-runner.svelte';

  type Mode = 'lookup' | 'prepare' | 'check_out' | 'check_in' | 'swap' | 'stock_take' | 'inspect' | 'receive';
  // Receiving transfers (FR-LOC-2) only makes sense with more than one location.
  const MODES = $derived<Mode[]>(['lookup', 'prepare', 'check_out', 'check_in', 'swap', 'stock_take', 'inspect', ...(session.singleLocation ? [] : (['receive'] as Mode[]))]);
  // Swap mode (FR-OR-10): the first scan is the unit coming back, the second its replacement.
  let swapFrom = $state<{ barcode: string; orderId: string } | null>(null);
  let swapStatus = $state<'needs_inspection' | 'soft_down' | 'hard_down'>('needs_inspection');
  type Entry = { id: number; code: string; tone: 'ok' | 'warn' | 'error'; text: string; href?: string; status?: string };

  let mode = $state<Mode>((typeof sessionStorage !== 'undefined' && (sessionStorage.getItem('scan.mode') as Mode)) || 'lookup');
  let code = $state('');
  let log = $state<Entry[]>([]);
  let video: HTMLVideoElement | undefined = $state();
  let camera = $state(false);
  let stream: MediaStream | null = null;
  let n = 0;

  // Prepare and check-out work on one order at a time: scan its QR code first.
  let order = $state<any>(null);
  let pick = $state<any>(null);
  let signer = $state('');
  let pad: ReturnType<typeof SignaturePad> | undefined = $state();
  let padEmpty = $state(true);
  let busy = $state(false);

  // Stock take.
  let locationId = $state(session.locations[0]?.id ?? '');
  let take = $state<any>(null);
  let applyOpen = $state(false);
  let applyForm = $state({ mark_missing_lost: true, move_found: true });

  // Inspecting (FR-MNT-3): the scanned unit's checklist opens.
  let inspecting = $state<{ id: string; barcode: string; name: string } | null>(null);

  // Receiving: transfers on their way to the location picked in the header (any location when none is).
  let incoming = $state<any[]>([]);

  const add = (e: Omit<Entry, 'id'>) => (log = [{ id: ++n, ...e }, ...log].slice(0, 100));

  async function loadIncoming() {
    const list = (await api.get(`/transfers?${qs({ status: 'in_transit', location_id: session.locationId || undefined })}`)).data;
    incoming = list.filter((tr: any) => !session.locationId || tr.to_location_id === session.locationId);
  }
  $effect(() => {
    void session.locationId;
    if (mode === 'receive') loadIncoming().catch(notifyError);
  });

  /** A unit is received on its transfer; a bulk barcode receives one of that product on the first transfer still bringing it. */
  async function receiveScan(c: string): Promise<boolean> {
    const r = await api.post('/scans', { code: c, mode: 'receive' });
    if (r.entity_type === 'stock_item' && r.entity.transfer_id) {
      const tr = await api.post(`/transfers/${r.entity.transfer_id}/actions/receive`, { barcodes: [c] });
      add({ code: c, tone: 'ok', text: t('scan.received', { name: r.entity.product_name, number: tr.number }), href: '/inventory/transfers', status: 'available' });
    } else {
      await loadIncoming();
      const tr = r.entity_type === 'stock_level' ? incoming.find((x) => x.lines.some((l: any) => !l.barcode && l.variant_id === r.entity.variant_id && l.outstanding > 0)) : null;
      if (!tr) throw new Error(t('scan.not_incoming', { code: c }));
      const line = tr.lines.find((l: any) => !l.barcode && l.variant_id === r.entity.variant_id && l.outstanding > 0);
      await api.post(`/transfers/${tr.id}/actions/receive`, { lines: [{ line_id: line.id, quantity: 1 }] });
      add({ code: c, tone: 'ok', text: t('scan.received', { name: r.entity.product_name, number: tr.number }), href: '/inventory/transfers' });
    }
    await loadIncoming();
    beep(true);
    return true;
  }

  $effect(() => {
    try {
      sessionStorage.setItem('scan.mode', mode);
    } catch {
      /* private mode */
    }
  });

  async function loadOrder(id: string) {
    order = await api.get(`/orders/${id}?expand=customer`);
    pick = await api.get(`/orders/${id}/pick_list`);
    signer = signer || order.customer?.name || '';
  }

  const remaining = $derived(pick ? pick.items.reduce((a: number, i: any) => a + (i.missing ?? 0), 0) : 0);

  async function handle(c: string): Promise<boolean> {
    try {
      if (mode === 'stock_take') return await stockTakeScan(c);
      if (mode === 'swap') return await swapScan(c);
      if (mode === 'receive') return await receiveScan(c);
      if (mode === 'inspect') {
        const r = await api.post('/scans', { code: c, mode: 'lookup' });
        if (r.entity_type !== 'stock_item') throw new Error(t('scan.not_found', { code: c }));
        inspecting = { id: r.entity.id, barcode: r.entity.barcode, name: r.entity.product_name };
        beep(true);
        return true;
      }
      const r = await api.post('/scans', { code: c, mode, order_id: order?.id });
      if (!r.entity_type) throw new Error(t('scan.not_found', { code: c }));
      if ((mode === 'prepare' || mode === 'check_out') && r.entity_type === 'order') {
        await loadOrder(r.entity.id);
        add({ code: c, tone: 'ok', text: t('scan.order_active', { number: r.entity.number }), href: `/orders/${r.entity.id}`, status: r.entity.status });
      } else if ((mode === 'prepare' || mode === 'check_out') && r.entity_type === 'stock_item') {
        if (!order) throw new Error(t('scan.order_first'));
        await api.post(`/orders/${order.id}/actions/assign_units`, { barcodes: [c] });
        await loadOrder(order.id);
        add({ code: c, tone: 'ok', text: t('order.scan.assigned', { code: c }) });
      } else if (mode === 'check_in' && r.entity_type === 'stock_item' && r.entity.current_order_id && r.entity.status === 'out') {
        await api.post(`/orders/${r.entity.current_order_id}/actions/check_in`, { units: [{ barcode: c, outcome: 'ok' }] });
        add({ code: c, tone: 'ok', text: t('scan.checked_in', { name: r.entity.product_name }), href: `/orders/${r.entity.current_order_id}`, status: 'available' });
      } else {
        const label = r.entity_type === 'order' ? t('order.title', { number: r.entity.number }) : r.entity_type === 'stock_item' ? `${r.entity.product_name} (${r.entity.barcode})` : (r.entity.name ?? r.entity.product_name);
        const href = r.entity_type === 'order' ? `/orders/${r.entity.id}` : r.entity_type === 'stock_item' && r.entity.current_order_id ? `/orders/${r.entity.current_order_id}` : r.entity_type === 'customer' ? `/customers/${r.entity.id}` : undefined;
        add({ code: c, tone: 'ok', text: r.suggested_action ? `${label} · ${t('scan.next', { action: t(`order.action.${r.suggested_action}` as any) })}` : label, href, status: r.entity.status });
      }
      beep(true);
    } catch (e) {
      beep(false);
      add({ code: c, tone: 'error', text: (e as Error).message });
    }
    return true;
  }

  async function swapScan(c: string): Promise<boolean> {
    if (!swapFrom) {
      const r = await api.post('/scans', { code: c, mode: 'lookup' });
      if (r.entity_type !== 'stock_item' || r.entity.status !== 'out' || !r.entity.current_order_id) throw new Error(t('swap.scan_out_unit', { code: c }));
      swapFrom = { barcode: r.entity.barcode, orderId: r.entity.current_order_id };
      add({ code: c, tone: 'ok', text: t('swap.scan_next', { code: r.entity.barcode }), href: `/orders/${r.entity.current_order_id}` });
    } else {
      const from = swapFrom;
      swapFrom = null;
      await api.post(`/orders/${from.orderId}/actions/swap_unit`, { from_barcode: from.barcode, to_barcode: c, old_status: swapStatus });
      add({ code: c, tone: 'ok', text: t('swap.done', { from: from.barcode, to: c }), href: `/orders/${from.orderId}`, status: 'out' });
    }
    beep(true);
    return true;
  }

  async function finishOrder() {
    if (!order) return;
    busy = true;
    try {
      if (mode === 'prepare') {
        await api.post(`/orders/${order.id}/actions/prepare`);
        toast.success(t('scan.prepared', { number: order.number }));
      } else {
        // A drawn signature is stored as an image and printed on the rental agreement.
        let file_id: string | undefined;
        if (!padEmpty && pad) {
          const blob = await pad.toBlob();
          if (blob) file_id = (await upload('/files?purpose=photo', blob, 'signature.png')).id;
        }
        await api.post(`/orders/${order.id}/actions/check_out`, { signature: signer.trim() ? { name: signer.trim(), method: file_id ? 'drawn' : 'typed', file_id } : undefined });
        toast.success(t('scan.picked_up', { number: order.number }));
      }
      add({ code: '', tone: 'ok', text: t('order.title', { number: order.number }), href: `/orders/${order.id}` });
      order = null;
      pick = null;
      signer = '';
      pad?.clear();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }

  async function startTake() {
    try {
      take = await api.post('/stock_takes', { location_id: locationId });
    } catch (e) {
      notifyError(e);
    }
  }

  async function stockTakeScan(c: string) {
    if (!take) throw new Error(t('stocktake.start_first'));
    const r = await api.post(`/stock_takes/${take.id}/scans`, { code: c });
    take = await api.get(`/stock_takes/${take.id}`);
    const name = r.unit ? `${r.unit.product_name} (${r.unit.barcode})` : c;
    if (r.result === 'found') add({ code: c, tone: 'ok', text: r.repeated ? t('stocktake.again', { name }) : name });
    else if (r.result === 'elsewhere') add({ code: c, tone: 'warn', text: t('stocktake.elsewhere', { name, location: r.unit.location_name }) });
    else add({ code: c, tone: 'error', text: r.message ?? t('scan.not_found', { code: c }) });
    beep(r.result === 'found');
    return true;
  }

  async function applyTake() {
    try {
      const r = await api.post(`/stock_takes/${take.id}/actions/apply`, applyForm);
      applyOpen = false;
      toast.success(t('stocktake.applied', { lost: r.result.lost.length, moved: r.result.moved.length }));
      take = null;
    } catch (e) {
      notifyError(e);
    }
  }

  async function cancelTake() {
    if (!(await confirmAction({ title: t('stocktake.cancel_title'), description: t('stocktake.cancel_description'), confirmLabel: t('stocktake.cancel'), destructive: true }))) return;
    try {
      await api.post(`/stock_takes/${take.id}/actions/cancel`);
      take = null;
    } catch (e) {
      notifyError(e);
    }
  }

  onMount(() => {
    const off = setScanHandler(handle);
    return () => {
      off();
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  });

  async function startCamera() {
    try {
      const detector = await createDetector();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      camera = true;
      await Promise.resolve();
      video!.srcObject = stream;
      await video!.play();
      let last = '';
      const tick = async () => {
        if (!camera || !video) return;
        try {
          const v = (await detector.detect(video))[0]?.rawValue;
          if (v && v !== last) {
            last = v;
            await handle(v);
            setTimeout(() => (last = ''), 2000);
          }
        } catch {
          /* frame not ready */
        }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      add({ code: '', tone: 'error', text: (e as Error).message });
    }
  }
  function stopCamera() {
    camera = false;
    stream?.getTracks().forEach((tr) => tr.stop());
  }
  const toneIcon = { ok: CircleCheckIcon, warn: TriangleAlertIcon, error: CircleAlertIcon };
  const toneClass = { ok: 'text-emerald-600', warn: 'text-amber-600', error: 'text-destructive' };
</script>

<svelte:head><title>{t('nav.scan')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.scan')} description={t('scan.description')}>
  {#snippet actions()}<ScannerSetup />{/snippet}
</PageHeader>
<PluginSlot slot="scan.mode" />

<div class="grid gap-6 lg:grid-cols-[400px_1fr]">
  <Card.Root class="h-fit">
    <Card.Header><Card.Title>{t('scan.mode')}</Card.Title></Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <ToggleGroup.Root type="single" variant="outline" value={mode} onValueChange={(v) => v && (mode = v as Mode)} class="grid w-full grid-cols-2 sm:grid-cols-3" aria-label={t('scan.mode')}>
        {#each MODES as m (m)}<ToggleGroup.Item value={m} class="data-[state=on]:bg-accent">{t(`scan.mode.${m}`)}</ToggleGroup.Item>{/each}
      </ToggleGroup.Root>
      <p class="text-muted-foreground text-sm">{t(`scan.hint.${mode}`)}</p>
      <form onsubmit={(e) => { e.preventDefault(); if (code.trim()) handle(code.trim()); code = ''; }}>
        <InputGroup.Root>
          <InputGroup.Addon><ScanBarcodeIcon /></InputGroup.Addon>
          <InputGroup.Input placeholder={t('scan.placeholder')} bind:value={code} data-scan="1" aria-label={t('scan.placeholder')} />
          <InputGroup.Addon align="inline-end"><InputGroup.Button type="submit">{t('scan.go')}</InputGroup.Button></InputGroup.Addon>
        </InputGroup.Root>
      </form>
      {#if camera}<Button variant="outline" onclick={stopCamera}>{t('scan.stop_camera')}</Button>{:else}<Button variant="outline" onclick={startCamera}><CameraIcon />{t('scan.use_camera')}</Button>{/if}
      {#if camera}<!-- svelte-ignore a11y_media_has_caption --><video bind:this={video} class="aspect-video w-full rounded-lg bg-black" muted playsinline></video>{/if}
    </Card.Content>
  </Card.Root>

  <div class="flex min-w-0 flex-col gap-6">
    {#if mode === 'prepare' || mode === 'check_out'}
      <Card.Root data-testid="scan-order">
        {#if order && pick}
          <Card.Header>
            <Card.Title class="flex flex-wrap items-center gap-2"><a class="hover:underline" href={to(`/orders/${order.id}`)}>{t('order.title', { number: order.number })}</a><StatusBadge status={order.status} label={t(`status.${order.status}` as any)} /></Card.Title>
            <Card.Description>{order.customer?.name ?? t('order.walk_in')}</Card.Description>
            <Card.Action><Button variant="ghost" size="icon-sm" aria-label={t('common.cancel')} onclick={() => { order = null; pick = null; }}><XIcon /></Button></Card.Action>
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <Table.Root>
              <Table.Body>
                {#each pick.items as it (it.line_id)}
                  <Table.Row>
                    <Table.Cell class="whitespace-normal"><div class="font-medium">{it.description}</div>{#if it.bins.length}<div class="text-muted-foreground text-xs">{t('scan.bins', { bins: it.bins.join(', ') })}</div>{/if}</Table.Cell>
                    <Table.Cell class="font-mono text-xs">{it.assigned.map((a: any) => a.barcode).join(', ')}</Table.Cell>
                    <Table.Cell class="text-right">
                      {#if it.tracking !== 'serialized'}<Badge variant="outline">{it.quantity} ×</Badge>{:else if it.missing}<Badge variant="outline" class="border-amber-500/40 text-amber-700 dark:text-amber-300">{t('scan.to_scan', { count: it.missing })}</Badge>{:else}<Badge variant="outline" class="border-emerald-600/30 text-emerald-700 dark:text-emerald-300"><CircleCheckIcon />{t('scan.done')}</Badge>{/if}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
            {#if mode === 'check_out'}
              <Field.Group>
                <Field.Field>
                  <Field.Label for="scan-signer">{t('order.signature')}</Field.Label>
                  <Input id="scan-signer" bind:value={signer} />
                </Field.Field>
                <SignaturePad bind:this={pad} bind:empty={padEmpty} label={t('scan.signature_pad')} clearLabel={t('scan.signature_clear')} undoLabel={t('scan.signature_undo')} />
              </Field.Group>
            {/if}
          </Card.Content>
          <Card.Footer class="flex-col items-stretch gap-2">
            {#if remaining}<p class="text-muted-foreground text-sm">{t('scan.remaining', { count: remaining })}</p>{/if}
            <Button size="lg" disabled={busy || remaining > 0} onclick={finishOrder}>
              {#if busy}<Spinner />{/if}{mode === 'prepare' ? t('order.action.prepare') : t('order.action.check_out')}
            </Button>
          </Card.Footer>
        {:else}
          <Card.Content>
            <Empty.Root>
              <Empty.Header><Empty.Media variant="icon"><ScanBarcodeIcon /></Empty.Media><Empty.Title>{t('scan.order_first')}</Empty.Title><Empty.Description>{t('scan.order_first_hint')}</Empty.Description></Empty.Header>
            </Empty.Root>
          </Card.Content>
        {/if}
      </Card.Root>
    {:else if mode === 'swap'}
      <Card.Root data-testid="swap-panel">
        <Card.Header>
          <Card.Title>{t('swap.scan_title')}</Card.Title>
          <Card.Description>{swapFrom ? t('swap.scan_next', { code: swapFrom.barcode }) : t('swap.scan_first')}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-wrap items-end gap-3">
          <Field.Field class="w-auto">
            <Field.Label for="scan-swap-status">{t('swap.old_status_short')}</Field.Label>
            <NativeSelect id="scan-swap-status" bind:value={swapStatus}>
              {#each ['needs_inspection', 'soft_down', 'hard_down'] as s (s)}<NativeSelectOption value={s}>{t(`status.${s}` as any)}</NativeSelectOption>{/each}
            </NativeSelect>
          </Field.Field>
          {#if swapFrom}<Button variant="outline" onclick={() => (swapFrom = null)}>{t('common.cancel')}</Button>{/if}
        </Card.Content>
      </Card.Root>
    {:else if mode === 'inspect'}
      <Card.Root data-testid="scan-inspect">
        <Card.Header>
          <Card.Title>{inspecting ? `${inspecting.name} (${inspecting.barcode})` : t('scan.inspect_title')}</Card.Title>
          <Card.Description>{t('scan.inspect_hint')}</Card.Description>
        </Card.Header>
        {#if inspecting}
          <Card.Content>
            {#key inspecting.id}
              <InspectionRunner
                stockItemId={inspecting.id}
                barcode={inspecting.barcode}
                autoOpen
                ondone={(r) => { add({ code: r.barcode, tone: r.passed ? 'ok' : 'warn', text: r.passed ? t('inspection.passed', { code: r.barcode }) : t('inspection.failed', { code: r.barcode }) }); inspecting = null; }}
                onnone={() => { add({ code: inspecting?.barcode ?? '', tone: 'warn', text: t('inspection.none', { code: inspecting?.barcode ?? '' }) }); inspecting = null; }}
              />
            {/key}
          </Card.Content>
        {/if}
      </Card.Root>
    {:else if mode === 'receive'}
      <Card.Root data-testid="scan-receive">
        <Card.Header>
          <Card.Title>{t('scan.incoming')}</Card.Title>
          <Card.Description>{session.location ? t('scan.incoming_to', { location: session.location.name }) : t('scan.incoming_all')}</Card.Description>
          <Card.Action><Button variant="outline" size="sm" href={to('/inventory/transfers')}>{t('transfers.title')}</Button></Card.Action>
        </Card.Header>
        <Card.Content>
          {#if incoming.length}
            <ul class="flex flex-col divide-y rounded-md border text-sm">
              {#each incoming as tr (tr.id)}
                <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span><span class="font-medium">#{tr.number}</span> · {tr.from_location_name} → {tr.to_location_name}</span>
                  <Badge variant="outline">{t('scan.still_coming', { count: tr.lines.reduce((a: number, l: any) => a + l.outstanding, 0) })}</Badge>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-muted-foreground text-sm">{t('scan.nothing_incoming')}</p>
          {/if}
        </Card.Content>
      </Card.Root>
    {:else if mode === 'stock_take'}
      <Card.Root data-testid="stock-take">
        <Card.Header>
          <Card.Title>{t('stocktake.title')}</Card.Title>
          <Card.Description>{t('stocktake.hint')}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          {#if !take}
            <div class="flex flex-wrap items-end gap-3">
              {#if session.locations.length > 1}
                <Field.Field class="w-64">
                  <Field.Label for="st-loc">{t('field.location')}</Field.Label>
                  <NativeSelect id="st-loc" class="w-full" bind:value={locationId}>{#each session.locations as l (l.id)}<NativeSelectOption value={l.id}>{l.name}</NativeSelectOption>{/each}</NativeSelect>
                </Field.Field>
              {/if}
              <Button onclick={startTake}>{t('stocktake.start')}</Button>
            </div>
          {:else}
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {#each [['found', take.found.length], ['missing', take.missing.length], ['elsewhere', take.elsewhere.length], ['unknown', take.unknown.length]] as [k, v] (k)}
                <div class="rounded-lg border p-3"><div class="text-muted-foreground text-xs">{t(`stocktake.count.${k}` as any)}</div><div class="text-2xl font-semibold tabular-nums">{v}</div></div>
              {/each}
            </div>
            {#if take.missing.length}
              <details class="rounded-lg border p-3 text-sm">
                <summary class="cursor-pointer font-medium">{t('stocktake.still_missing', { count: take.missing.length })}</summary>
                <ul class="mt-2 grid gap-1 sm:grid-cols-2">{#each take.missing as u (u.id)}<li><span class="font-mono text-xs">{u.barcode}</span> · {u.product_name}{#if u.bin} · {u.bin}{/if}</li>{/each}</ul>
              </details>
            {/if}
          {/if}
        </Card.Content>
        {#if take}
          <Card.Footer class="flex gap-2">
            <Button onclick={() => (applyOpen = true)}>{t('stocktake.finish')}</Button>
            <Button variant="ghost" onclick={cancelTake}>{t('stocktake.cancel')}</Button>
          </Card.Footer>
        {/if}
      </Card.Root>
    {/if}

    <Card.Root>
      <Card.Header><Card.Title>{t('scan.results')}</Card.Title></Card.Header>
      <Card.Content aria-live="polite">
        {#if log.length}
          <Item.Group class="gap-2">
            {#each log as l (l.id)}
              {@const Icon = toneIcon[l.tone]}
              <Item.Root variant="outline" size="sm" data-tone={l.tone}>
                <Item.Media><Icon class={toneClass[l.tone]} /></Item.Media>
                <Item.Content>
                  <Item.Title>{#if l.href}<a href={to(l.href)} class="hover:underline" onclick={(e) => { e.preventDefault(); goto(to(l.href!)); }}>{l.text}</a>{:else}{l.text}{/if}</Item.Title>
                  {#if l.code}<Item.Description class="font-mono">{l.code}</Item.Description>{/if}
                </Item.Content>
                {#if l.status}<Item.Actions><StatusBadge status={l.status} label={t(`status.${l.status}` as any)} /></Item.Actions>{/if}
              </Item.Root>
            {/each}
          </Item.Group>
        {:else}
          <Empty.Root>
            <Empty.Header><Empty.Media variant="icon"><ScanBarcodeIcon /></Empty.Media><Empty.Title>{t('scan.empty_title')}</Empty.Title><Empty.Description>{t('scan.empty_description')}</Empty.Description></Empty.Header>
          </Empty.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>

<Dialog.Root bind:open={applyOpen}>
  <Dialog.Content>
    <Dialog.Header><Dialog.Title>{t('stocktake.finish_title')}</Dialog.Title><Dialog.Description>{t('stocktake.finish_description')}</Dialog.Description></Dialog.Header>
    {#if take}
      <Field.Group>
        <Field.Field orientation="horizontal"><Checkbox id="st-lost" bind:checked={applyForm.mark_missing_lost} disabled={!take.missing.length} /><Field.Label for="st-lost" class="font-normal">{t('stocktake.mark_lost', { count: take.missing.length })}</Field.Label></Field.Field>
        <Field.Field orientation="horizontal"><Checkbox id="st-move" bind:checked={applyForm.move_found} disabled={!take.elsewhere.length} /><Field.Label for="st-move" class="font-normal">{t('stocktake.move_found', { count: take.elsewhere.length })}</Field.Label></Field.Field>
      </Field.Group>
    {/if}
    <Dialog.Footer>
      <Dialog.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Dialog.Close>
      <Button onclick={applyTake}>{t('stocktake.apply')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
