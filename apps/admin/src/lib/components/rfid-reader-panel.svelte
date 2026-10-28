<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Item from '@openrent/ui/item';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import RadioIcon from '@lucide/svelte/icons/radio';
  import { api, t, toast, notifyError } from '#lib';

  /**
   * RFID on the scan page (FR-SCAN-7): while reading, the chosen reader's tags show here as units; one
   * press takes them all onto the order (pickup) or back (return). Tags no unit has are listed apart.
   */
  let { mode, orderId = null, ondone }: { mode: 'check_out' | 'check_in'; orderId?: string | null; ondone?: (r: any) => void } = $props();
  let readers = $state<any[]>([]);
  let readerId = $state('');
  let since = $state<string | null>(null);
  let seen = $state<any>(null);
  let busy = $state(false);
  let timer = $state<ReturnType<typeof setInterval> | null>(null);

  onMount(async () => {
    try {
      readers = (await api.get('/rfid/readers')).data;
      readerId = readers[0]?.id ?? '';
    } catch (e) {
      notifyError(e);
    }
  });
  onDestroy(stop);

  async function poll() {
    if (!readerId) return;
    try {
      // The first answer names the server's time; later ones ask from it.
      seen = await api.get(`/rfid/readers/${readerId}/reads${since ? `?since=${encodeURIComponent(since)}` : ''}`);
      since = seen.since;
    } catch (e) {
      stop();
      notifyError(e);
    }
  }
  function start() {
    since = null;
    seen = null;
    timer = setInterval(poll, 1000);
    poll();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function take() {
    if (!seen?.units.length) return;
    busy = true;
    stop();
    try {
      const r = await api.post('/scans/tags', { mode, order_id: mode === 'check_out' ? orderId : null, epcs: seen.units.flatMap((u: any) => u.epcs) });
      toast.success(t(mode === 'check_out' ? 'rfid.assigned_count' : 'rfid.checked_in_count', { count: r.applied }));
      ondone?.(r);
      since = null;
      seen = null;
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if readers.length}
  <Card.Root data-testid="rfid-panel">
    <Card.Header>
      <Card.Title class="flex items-center gap-2"><RadioIcon class="size-4" aria-hidden="true" />{t('rfid.title')}</Card.Title>
      <Card.Description>{t(mode === 'check_out' ? 'rfid.hint_out' : 'rfid.hint_in')}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-2">
        {#if readers.length > 1}
          <NativeSelect id="rfid-reader" aria-label={t('rfid.reader')} bind:value={readerId} disabled={!!timer}>
            {#each readers as r (r.id)}<NativeSelectOption value={r.id}>{r.name}</NativeSelectOption>{/each}
          </NativeSelect>
        {/if}
        {#if timer}
          <Button variant="outline" onclick={stop}>{t('rfid.stop')}</Button>
        {:else}
          <Button variant="outline" disabled={mode === 'check_out' && !orderId} onclick={start}>{t('rfid.start')}</Button>
        {/if}
        {#if timer}<span class="text-muted-foreground flex items-center gap-2 text-sm" aria-live="polite"><Spinner />{t('rfid.reading')}</span>{/if}
      </div>
      {#if seen}
        <p class="text-sm" data-testid="rfid-counts">{t('rfid.counts', { units: seen.units.length, unknown: seen.unknown.length })}</p>
        {#if seen.units.length}
          <Item.Group class="max-h-72 gap-1 overflow-y-auto">
            {#each seen.units as u (u.id)}
              <Item.Root variant="outline" size="sm">
                <Item.Content><Item.Title>{u.product_name}{u.variant_name && u.variant_name !== u.product_name ? ` · ${u.variant_name}` : ''}</Item.Title><Item.Description class="font-mono">{u.barcode}</Item.Description></Item.Content>
                <Item.Actions><Badge variant="secondary">{t(`status.${u.status}` as any)}</Badge></Item.Actions>
              </Item.Root>
            {/each}
          </Item.Group>
        {/if}
        {#if seen.unknown.length}
          <details class="text-sm">
            <summary class="cursor-pointer">{t('rfid.unknown_tags', { count: seen.unknown.length })}</summary>
            <ul class="mt-2 font-mono text-xs">{#each seen.unknown as e (e)}<li>{e}</li>{/each}</ul>
          </details>
        {/if}
        <div><Button disabled={busy || !seen.units.length} onclick={take}>{#if busy}<Spinner />{/if}{t(mode === 'check_out' ? 'rfid.take_out' : 'rfid.take_in', { count: seen.units.length })}</Button></div>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}
