<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { StatusBadge } from '@openrent/ui/openrent';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';
  import { ApiError } from '#lib/api.ts';
  import { to } from '#lib/nav.ts';

  /** What a unit holds when it is used as a case (FR-CAT-11); scanning the case then scans these too. */
  let { unitId, canEdit, onchange }: { unitId: string; canEdit: boolean; onchange?: () => void } = $props();
  let contents = $state<any[]>([]);
  let code = $state('');
  let error = $state('');
  let busy = $state(false);

  async function load() {
    try {
      contents = (await api.get(`/stock_items/${unitId}/contents`)).data;
    } catch (e) {
      notifyError(e);
    }
  }
  $effect(() => {
    void unitId;
    load();
  });

  async function change(action: 'pack' | 'unpack', body: Record<string, unknown>, done: string) {
    busy = true;
    error = '';
    try {
      contents = (await api.post(`/stock_items/${unitId}/actions/${action}`, body)).contents;
      toast.success(done);
      onchange?.();
      return true;
    } catch (e) {
      // A unit that cannot go in (other location, unknown code) is told at the barcode field.
      if (e instanceof ApiError && e.status === 422) error = Object.values(fieldErrors(e))[0] ?? e.message;
      else if (e instanceof ApiError && e.status === 404 && action === 'pack') error = e.message;
      else notifyError(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function pack(e: SubmitEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    if (await change('pack', { barcodes: [code.trim()] }, t('case.packed', { code: code.trim() }))) code = '';
  }
</script>

<Card.Root data-testid="unit-case">
  <Card.Header>
    <Card.Title>{t('case.title')}</Card.Title>
    <Card.Description>{t('case.hint')}</Card.Description>
    {#if canEdit && contents.length}
      <Card.Action><Button variant="outline" size="sm" disabled={busy} onclick={() => change('unpack', { all: true }, t('case.emptied'))}>{t('case.empty')}</Button></Card.Action>
    {/if}
  </Card.Header>
  <Card.Content class="flex flex-col gap-4 text-sm">
    {#each contents as c (c.id)}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
        <span><a class="font-medium hover:underline" href={to(`/inventory/units/${c.id}`)}>{c.barcode}</a> {c.product_name}{#if c.contents_count} · {t('case.holds', { count: c.contents_count })}{/if}</span>
        <span class="flex items-center gap-2">
          <StatusBadge status={c.status} label={t(`status.${c.status}` as any)} />
          {#if canEdit}<Button variant="ghost" size="sm" disabled={busy} aria-label={t('case.remove_aria', { code: c.barcode })} onclick={() => change('unpack', { stock_item_ids: [c.id] }, t('case.removed', { code: c.barcode }))}>{t('case.remove')}</Button>{/if}
        </span>
      </div>
    {:else}
      <p class="text-muted-foreground">{t('case.none')}</p>
    {/each}
    {#if canEdit}
      <form class="flex items-end gap-2" onsubmit={pack}>
        <Field.Field class="flex-1" data-invalid={error ? true : undefined}>
          <Field.Label for="case-code">{t('case.add_label')}</Field.Label>
          <Input id="case-code" bind:value={code} autocomplete="off" aria-invalid={error ? true : undefined} />
          {#if error}<Field.Error>{error}</Field.Error>{/if}
        </Field.Field>
        <Button type="submit" disabled={busy || !code.trim()}>{t('case.add')}</Button>
      </form>
    {/if}
  </Card.Content>
</Card.Root>
