<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import { Button } from '@openrent/ui/button';
  import { Textarea } from '@openrent/ui/textarea';
  import RadioIcon from '@lucide/svelte/icons/radio';
  import { api, t, toast, notifyError, fieldErrors, session } from '#lib';

  /** A unit's RFID tags (FR-SCAN-7): one EPC per line; scan a tag into the box with a USB reader. */
  let { stockItemId }: { stockItemId: string } = $props();
  let epcs = $state<string[]>([]);
  let open = $state(false);
  let text = $state('');
  let error = $state('');
  const canEdit = $derived(session.can('inventory:write'));

  async function load() {
    try {
      epcs = (await api.get(`/stock_items/${stockItemId}/rfid_tags`)).epcs;
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    try {
      epcs = (await api.put(`/stock_items/${stockItemId}/rfid_tags`, { epcs: lines })).epcs;
      toast.success(t('common.saved'));
      open = false;
    } catch (err) {
      const f = fieldErrors(err);
      if (!Object.keys(f).length) return notifyError(err);
      // Each problem names its line, so a long list of tags stays easy to fix.
      error = Object.entries(f).map(([k, v]) => (/^epcs\.(\d+)$/.test(k) ? t('rfid.line', { line: Number(k.split('.')[1]) + 1, message: v }) : v)).join(' ');
    }
  }
</script>

<Card.Root data-testid="rfid-tags">
  <Card.Header>
    <Card.Title class="flex items-center gap-2"><RadioIcon class="size-4" aria-hidden="true" />{t('rfid.tags')}</Card.Title>
    {#if canEdit}<Card.Action><Button size="sm" variant="outline" onclick={() => { text = epcs.join('\n'); error = ''; open = true; }}>{t('common.edit')}</Button></Card.Action>{/if}
  </Card.Header>
  <Card.Content>
    {#if epcs.length}
      <ul class="flex flex-col gap-1 font-mono text-xs">{#each epcs as e (e)}<li>{e}</li>{/each}</ul>
    {:else}
      <p class="text-muted-foreground text-sm">{t('rfid.no_tags')}</p>
    {/if}
  </Card.Content>
</Card.Root>

<Dialog.Root bind:open>
  <Dialog.Content>
    <form class="flex flex-col gap-4" onsubmit={save}>
      <Dialog.Header>
        <Dialog.Title>{t('rfid.tags')}</Dialog.Title>
        <Dialog.Description>{t('rfid.tags_hint')}</Dialog.Description>
      </Dialog.Header>
      <Field.Field data-invalid={!!error || undefined}>
        <Field.Label for="rfid-epcs">{t('rfid.epcs')}</Field.Label>
        <Textarea id="rfid-epcs" rows={5} class="font-mono" bind:value={text} aria-invalid={!!error} />
        {#if error}<Field.Error>{error}</Field.Error>{/if}
      </Field.Field>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
        <Button type="submit">{t('common.save')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
