<script lang="ts">
  import { onMount } from 'svelte';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
  import { api, t, toast, notifyError, fieldErrors, getLocale } from '#lib';

  /**
   * Runs the checklist that covers a unit (FR-MNT-3). The button shows only when a checklist applies;
   * `autoOpen` opens it right away (the scan page). A failure takes the unit out of service with a ticket.
   */
  let {
    stockItemId, barcode, orderId = null, autoOpen = false, ondone, onnone,
  }: { stockItemId: string; barcode: string; orderId?: string | null; autoOpen?: boolean; ondone?: (inspection: any) => void; onnone?: () => void } = $props();
  let template = $state<any>(null);
  let open = $state(false);
  let answers = $state<Record<string, { passed: boolean | null; value: string; note: string }>>({});
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let result = $state<any>(null);

  onMount(async () => {
    try {
      template = (await api.get(`/stock_items/${stockItemId}/inspection_template`)).template;
      if (template && autoOpen) start();
      else if (!template) onnone?.();
    } catch (e) {
      notifyError(e);
    }
  });

  function start() {
    answers = Object.fromEntries(template.items.map((it: any) => [it.key, { passed: it.kind === 'check' ? null : true, value: '', note: '' }]));
    errors = {};
    open = true;
  }
  const label = (it: any) => it.label[getLocale()] ?? Object.values(it.label)[0] ?? it.key;

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      const results = template.items.map((it: any) => {
        const a = answers[it.key]!;
        return { key: it.key, passed: a.passed ?? undefined, value: it.kind === 'check' ? undefined : a.value === '' ? null : it.kind === 'number' ? Number(a.value) : a.value, note: a.note || undefined };
      });
      result = await api.post(`/stock_items/${stockItemId}/inspections`, { template_id: template.id, order_id: orderId, results });
      toast[result.passed ? 'success' : 'warning'](result.passed ? t('inspection.passed', { code: barcode }) : t('inspection.failed', { code: barcode }));
      open = false;
      ondone?.(result);
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if template}
  {#if result}
    <Badge variant={result.passed ? 'secondary' : 'destructive'}>{result.passed ? t('inspection.result_passed', { code: barcode }) : t('inspection.result_failed', { code: barcode })}</Badge>
  {:else}
    <Button type="button" size="sm" variant="outline" onclick={start}><ClipboardCheckIcon />{t('inspection.run', { code: barcode })}</Button>
  {/if}
  <Dialog.Root bind:open>
    <Dialog.Content class="max-h-[90svh] overflow-y-auto sm:max-w-lg">
      <form class="flex flex-col gap-4" onsubmit={submit} novalidate data-testid="inspection-runner">
        <Dialog.Header>
          <Dialog.Title>{template.name}</Dialog.Title>
          <Dialog.Description class="font-mono">{barcode}</Dialog.Description>
        </Dialog.Header>
        <Field.Group>
          {#each template.items as it (it.key)}
            {@const a = answers[it.key]}
            {@const err = errors[`results.${it.key}`]}
            {#if a}
              <Field.Field data-invalid={!!err || undefined}>
                <Field.Label for={`ins-${it.key}`}>{label(it)}{#if !it.required} <span class="text-muted-foreground font-normal">{t('inspection.optional')}</span>{/if}</Field.Label>
                {#if it.kind === 'check'}
                  <ToggleGroup.Root id={`ins-${it.key}`} type="single" variant="outline" value={a.passed === null ? '' : a.passed ? 'pass' : 'fail'} onValueChange={(v) => (a.passed = v === 'pass' ? true : v === 'fail' ? false : null)} aria-label={label(it)} aria-invalid={!!err}>
                    <ToggleGroup.Item value="pass" class="data-[state=on]:bg-emerald-100 data-[state=on]:text-emerald-800 dark:data-[state=on]:bg-emerald-950 dark:data-[state=on]:text-emerald-200">{t('inspection.pass')}</ToggleGroup.Item>
                    <ToggleGroup.Item value="fail" class="data-[state=on]:bg-red-100 data-[state=on]:text-red-800 dark:data-[state=on]:bg-red-950 dark:data-[state=on]:text-red-200">{t('inspection.fail')}</ToggleGroup.Item>
                  </ToggleGroup.Root>
                {:else if it.kind === 'number'}
                  <Input id={`ins-${it.key}`} type="number" step="any" class="w-32" bind:value={a.value} aria-invalid={!!err} />
                  {#if it.min != null || it.max != null}<Field.Description>{t('inspection.range', { min: it.min ?? '–', max: it.max ?? '–' })}</Field.Description>{/if}
                {:else}
                  <Textarea id={`ins-${it.key}`} bind:value={a.value} aria-invalid={!!err} />
                {/if}
                {#if err}<Field.Error>{err}</Field.Error>{/if}
                {#if it.kind !== 'text'}
                  <Input placeholder={t('inspection.note')} aria-label={t('inspection.note_for', { name: label(it) })} bind:value={a.note} />
                {/if}
              </Field.Field>
            {/if}
          {/each}
        </Field.Group>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('inspection.save')}</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
{/if}
