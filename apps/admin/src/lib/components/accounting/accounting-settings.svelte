<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';

  /** When invoices are issued, the lock date, and how the connected system receives entries. */
  let { connection, system, onchange }: { connection: any; system: any; onchange: () => Promise<void> } = $props();
  let invoiceWhen = $state('manual');
  let lockedUntil = $state('');
  let errors = $state<Record<string, string>>({});
  let conn = $state<Record<string, any>>({});

  onMount(async () => {
    const s = await api.get('/tenant/settings').catch(() => null);
    invoiceWhen = s?.accounting?.invoice_when ?? 'manual';
    lockedUntil = s?.accounting?.locked_until ?? '';
  });
  $effect(() => {
    conn = { ...(connection?.settings ?? {}) };
  });

  async function saveBooks(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    try {
      await api.patch('/accounting/settings', { invoice_when: invoiceWhen, locked_until: lockedUntil || null });
      toast.success(t('common.saved'));
    } catch (err) {
      errors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^accounting\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(err);
    }
  }
  async function saveConnection(key: string, value: unknown) {
    try {
      await api.patch('/accounting/connection', { settings: { [key]: value } });
      toast.success(t('common.saved'));
      await onchange();
    } catch (err) {
      notifyError(err);
    }
  }
</script>

<div class="flex max-w-3xl flex-col gap-6">
  <Card.Root>
    <Card.Header><Card.Title>{t('accounting.books_title')}</Card.Title><Card.Description>{t('accounting.books_hint')}</Card.Description></Card.Header>
    <Card.Content>
      <form class="flex flex-col gap-4" onsubmit={saveBooks} novalidate>
        <Field.Field data-invalid={!!errors.invoice_when || undefined}>
          <Field.Label for="acc-when">{t('accounting.invoice_when')}</Field.Label>
          <NativeSelect.Root id="acc-when" class="w-full" bind:value={invoiceWhen}>
            {#each ['manual', 'reserved', 'checked_out', 'closed'] as w (w)}<NativeSelect.Option value={w}>{t(`accounting.invoice_when.${w}` as any)}</NativeSelect.Option>{/each}
          </NativeSelect.Root>
          <Field.Description>{t('accounting.invoice_when_hint')}</Field.Description>
        </Field.Field>
        <Field.Field class="max-w-xs" data-invalid={!!errors.locked_until || undefined}>
          <Field.Label for="acc-lock">{t('accounting.lock_date')}</Field.Label>
          <Input id="acc-lock" type="date" bind:value={lockedUntil} aria-invalid={!!errors.locked_until} />
          {#if errors.locked_until}<Field.Error>{errors.locked_until}</Field.Error>{:else}<Field.Description>{t('accounting.lock_date_hint')}</Field.Description>{/if}
        </Field.Field>
        <div><Button type="submit" variant="outline">{t('common.save')}</Button></div>
      </form>
    </Card.Content>
  </Card.Root>

  {#if connection && system}
    <Card.Root>
      <Card.Header><Card.Title>{t('accounting.sending_title', { name: connection.provider_name })}</Card.Title></Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#each system.settings_schema as s (s.key)}
          {#if s.type === 'boolean'}
            <Field.Field orientation="horizontal">
              <Switch id={`acc-c-${s.key}`} checked={conn[s.key] !== false} onCheckedChange={(v) => saveConnection(s.key, v)} />
              <Field.Content><Field.Label for={`acc-c-${s.key}`}>{s.label}</Field.Label>{#if s.help}<Field.Description>{s.help}</Field.Description>{/if}</Field.Content>
            </Field.Field>
          {:else if s.type === 'select'}
            <Field.Field class="max-w-sm">
              <Field.Label for={`acc-c-${s.key}`}>{s.label}</Field.Label>
              <NativeSelect.Root id={`acc-c-${s.key}`} class="w-full" value={conn[s.key] ?? s.options?.[0] ?? ''} onchange={(e) => saveConnection(s.key, (e.currentTarget as HTMLSelectElement).value)}>
                {#each s.options ?? [] as o (o)}<NativeSelect.Option value={o}>{o}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
              {#if s.help}<Field.Description>{s.help}</Field.Description>{/if}
            </Field.Field>
          {/if}
        {/each}
        {#if system.imports_payments}
          <Field.Field orientation="horizontal">
            <Switch id="acc-c-import" checked={conn.import_payments === true} onCheckedChange={(v) => saveConnection('import_payments', v)} />
            <Field.Content><Field.Label for="acc-c-import">{t('accounting.import_payments', { name: connection.provider_name })}</Field.Label><Field.Description>{t('accounting.import_payments_hint', { name: connection.provider_name })}</Field.Description></Field.Content>
          </Field.Field>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</div>
