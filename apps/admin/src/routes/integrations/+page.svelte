<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { PageHeader, StatusBadge } from '@openrent/ui/openrent';
  import PlugIcon from '@lucide/svelte/icons/plug';
  import { api, qs, t, toast, notifyError, fieldErrors, confirmAction, dt, session } from '#lib';
  import { to } from '#lib/nav.ts';
  import LandmarkIcon from '@lucide/svelte/icons/landmark';

  /**
   * Integrations with other systems (accounting first): connect, see what was brought across, retry,
   * catch up and disconnect. Each integration comes from a plugin.
   */
  let list = $state<any[] | null>(null);
  let redirectUri = $state<string | null>(null);
  let busy = $state('');
  let fieldsFor = $state<any>(null);
  let creds = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});
  let open = $state<any>(null);
  let settings = $state<Record<string, string>>({});
  let tasks = $state<any[]>([]);
  let filter = $state('');
  let catchFrom = $state(new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const STATUS_TONE: Record<string, string> = { connected: 'paid', error: 'failed', pending: 'pending', done: 'paid', skipped: 'draft', failed: 'failed', running: 'pending' };

  async function load() {
    // Accounting systems are set up on the Accounting page (ADR 0009).
    const r = await api.get('/integrations');
    // What staff enter as the redirect URL in the provider's app settings.
    redirectUri = r.redirect_uri ?? null;
    list = r.data.filter((i: any) => i.category !== 'accounting');
    if (open) open = list!.find((i) => i.id === open.id) ?? null;
  }
  onMount(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('connected')) toast.success(t('integrations.connected_toast'));
    if (p.get('integration_error')) toast.error(t('integrations.connect_failed'));
    load().catch(notifyError);
  });

  async function connect(i: any) {
    if (i.auth === 'fields') {
      fieldsFor = i;
      creds = {};
      errors = {};
      return;
    }
    busy = i.id;
    try {
      // The provider's sign-in page; it sends the shop back to this page.
      location.href = (await api.post(`/integrations/${i.id}/connect`, {})).authorize_url;
    } catch (e) {
      notifyError(e);
      busy = '';
    }
  }

  async function saveFields(e: SubmitEvent) {
    e.preventDefault();
    busy = fieldsFor.id;
    errors = {};
    try {
      await api.post(`/integrations/${fieldsFor.id}/connect`, { credentials: creds });
      toast.success(t('integrations.connected_toast'));
      fieldsFor = null;
      await load();
    } catch (err) {
      const fe = fieldErrors(err);
      errors = Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^credentials\./, ''), v]));
      if (!Object.keys(fe).length) notifyError(err);
    } finally {
      busy = '';
    }
  }

  async function show(i: any) {
    open = i;
    settings = Object.fromEntries((i.settings_schema ?? []).map((s: any) => [s.key, String(i.connection?.settings?.[s.key] ?? '')]));
    await loadTasks();
  }
  async function loadTasks() {
    if (!open?.connection) return;
    tasks = (await api.get(`/integration_connections/${open.connection.id}/tasks?${qs({ status: filter || undefined })}`)).data;
  }
  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast.success(done);
      await load();
      await loadTasks();
    } catch (e) {
      notifyError(e);
    }
  }
  async function disconnect() {
    if (!(await confirmAction({ title: t('integrations.disconnect_title', { name: open.name }), description: t('integrations.disconnect_description'), confirmLabel: t('integrations.disconnect'), destructive: true }))) return;
    await run(() => api.del(`/integration_connections/${open.connection.id}`), t('integrations.disconnected_toast', { name: open.name }));
    open = null;
  }
</script>

<svelte:head><title>{t('nav.integrations')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.integrations')} description={t('integrations.description')} />

{#if !list}
  <Skeleton class="h-48 rounded-xl" />
{:else}
  <div class="grid gap-4 md:grid-cols-2" data-testid="integrations">
    {#each list as i (i.id)}
      <Card.Root data-testid="integration-card" data-integration={i.id}>
        <Card.Header>
          <Card.Title class="flex items-center gap-2"><PlugIcon class="size-4" />{i.name}</Card.Title>
          <Card.Description>{t(`integrations.category.${i.category}` as any)}</Card.Description>
          <Card.Action>
            {#if i.connection}<StatusBadge status={STATUS_TONE[i.connection.status]} label={t(`integrations.status.${i.connection.status}` as any)} />{/if}
          </Card.Action>
        </Card.Header>
        <Card.Content class="flex flex-col gap-2 text-sm">
          {#if i.connection?.status === 'connected' || i.connection?.status === 'error'}
            <p>{t('integrations.account', { name: i.connection.account_name ?? '—' })}</p>
            <p class="text-muted-foreground">{i.connection.last_sync_at ? t('integrations.last_sync', { when: dt(i.connection.last_sync_at) }) : t('integrations.never_synced')}</p>
            {#if i.connection.last_error}<p class="text-destructive">{i.connection.last_error}</p>{/if}
          {:else if !i.enabled}
            <p class="text-muted-foreground">{t('integrations.plugin_off_hint')}</p>
          {:else if !i.ready}
            <p class="text-muted-foreground">{t('integrations.not_ready')} <a class="underline" href={to('/plugins')}>{t('nav.plugins')}</a></p>
          {:else}
            <p class="text-muted-foreground">{t('integrations.not_connected')}</p>
          {/if}
          {#if i.auth === 'oauth2' && redirectUri && i.connection?.status !== 'connected'}
            <div class="flex flex-col gap-1" data-testid="integration-redirect">
              <span class="text-muted-foreground">{t('integrations.redirect_url')}</span>
              <code class="bg-muted rounded px-2 py-1 text-xs [overflow-wrap:anywhere]">{redirectUri}</code>
            </div>
          {/if}
        </Card.Content>
        <Card.Footer class="flex flex-wrap gap-2">
          {#if i.connection?.status === 'connected' || i.connection?.status === 'error'}
            <Button variant="outline" onclick={() => show(i)}>{t('integrations.manage')}</Button>
          {:else}
            <Button disabled={!i.enabled || !i.ready || busy === i.id} onclick={() => connect(i)}>{#if busy === i.id}<Spinner />{/if}{t('integrations.connect')}</Button>
          {/if}
        </Card.Footer>
      </Card.Root>
    {:else}
      <p class="text-muted-foreground text-sm">{t('integrations.none')}</p>
    {/each}
  </div>
  {#if session.can('accounting:read')}
    <Card.Root class="mt-6" data-testid="accounting-link">
      <Card.Header>
        <Card.Title class="flex items-center gap-2"><LandmarkIcon class="size-4" />{t('nav.accounting')}</Card.Title>
        <Card.Description>{t('integrations.accounting_moved')}</Card.Description>
      </Card.Header>
      <Card.Footer><Button variant="outline" href={to('/accounting')}>{t('integrations.open_accounting')}</Button></Card.Footer>
    </Card.Root>
  {/if}
{/if}

<!-- Typed credentials (an API key). -->
<Dialog.Root open={!!fieldsFor} onOpenChange={(v) => !v && (fieldsFor = null)}>
  <Dialog.Content>
    {#if fieldsFor}
      <form class="flex flex-col gap-4" onsubmit={saveFields} novalidate>
        <Dialog.Header><Dialog.Title>{t('integrations.connect_to', { name: fieldsFor.name })}</Dialog.Title></Dialog.Header>
        <Field.Group>
          {#each fieldsFor.fields as f (f.key)}
            <Field.Field data-invalid={!!errors[f.key] || undefined}>
              <Field.Label for={`ic-${f.key}`}>{f.label}</Field.Label>
              <Input id={`ic-${f.key}`} type={f.type === 'secret' ? 'password' : 'text'} autocomplete="off" bind:value={creds[f.key]} aria-invalid={!!errors[f.key]} />
              {#if errors[f.key]}<Field.Error>{errors[f.key]}</Field.Error>{:else if f.help}<Field.Description>{f.help}</Field.Description>{/if}
            </Field.Field>
          {/each}
        </Field.Group>
        <Dialog.Footer><Button type="submit" disabled={!!busy}>{#if busy}<Spinner />{/if}{t('integrations.connect')}</Button></Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- One connection: settings, catch-up, sync log, disconnect. -->
<Sheet.Root open={!!open} onOpenChange={(v) => !v && (open = null)}>
  <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
    {#if open?.connection}
      <div class="flex flex-col gap-6 p-4">
        <Sheet.Header class="p-0">
          <Sheet.Title>{open.name}</Sheet.Title>
          <Sheet.Description>{t('integrations.account', { name: open.connection.account_name ?? '—' })}</Sheet.Description>
        </Sheet.Header>
        {#if open.settings_schema.length}
          <form class="flex flex-col gap-3" onsubmit={(e) => { e.preventDefault(); run(() => api.patch(`/integration_connections/${open.connection.id}`, { settings }), t('common.saved')); }}>
            <h3 class="text-sm font-medium">{t('integrations.settings')}</h3>
            {#each open.settings_schema as s (s.key)}
              <Field.Field>
                <Field.Label for={`is-${s.key}`}>{s.label}</Field.Label>
                {#if s.type === 'select'}
                  <NativeSelect.Root id={`is-${s.key}`} class="w-full" bind:value={settings[s.key]}><NativeSelect.Option value="">—</NativeSelect.Option>{#each s.options ?? [] as o (o)}<NativeSelect.Option value={o}>{o}</NativeSelect.Option>{/each}</NativeSelect.Root>
                {:else}
                  <Input id={`is-${s.key}`} bind:value={settings[s.key]} />
                {/if}
                {#if s.help}<Field.Description>{s.help}</Field.Description>{/if}
              </Field.Field>
            {/each}
            <div><Button type="submit" variant="outline">{t('common.save')}</Button></div>
          </form>
        {/if}
        <div class="flex flex-wrap items-end gap-2">
          <Field.Field class="w-44">
            <Field.Label for="ic-from">{t('integrations.catch_up_from')}</Field.Label>
            <Input id="ic-from" type="date" bind:value={catchFrom} />
          </Field.Field>
          <Button variant="outline" onclick={() => run(async () => { const r = await api.post(`/integration_connections/${open.connection.id}/actions/catch_up`, { from: new Date(`${catchFrom}T00:00:00Z`).toISOString() }); toast.info(t('integrations.queued', { count: r.queued })); }, t('integrations.catch_up_started'))}>{t('integrations.catch_up')}</Button>
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-medium">{t('integrations.log')}</h3>
            <NativeSelect.Root size="sm" bind:value={filter} onchange={loadTasks} aria-label={t('integrations.log_filter')}>
              <NativeSelect.Option value="">{t('integrations.all')}</NativeSelect.Option>
              {#each ['pending', 'done', 'skipped', 'failed'] as s (s)}<NativeSelect.Option value={s}>{t(`integrations.task.${s}` as any)}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          </div>
          <Table.Root data-testid="integration-log">
            <Table.Body>
              {#each tasks as tk (tk.id)}
                <Table.Row>
                  <Table.Cell class="text-xs"><div class="font-mono">{tk.event}</div><div class="text-muted-foreground">{dt(tk.created_at)}</div></Table.Cell>
                  <Table.Cell class="text-xs whitespace-normal">{tk.message ?? ''}{#if tk.attempts > 1} <Badge variant="outline">{t('integrations.attempts', { count: tk.attempts })}</Badge>{/if}</Table.Cell>
                  <Table.Cell class="text-right">
                    <StatusBadge status={STATUS_TONE[tk.status]} label={t(`integrations.task.${tk.status}` as any)} />
                    {#if tk.status === 'failed' || (tk.status === 'pending' && tk.attempts > 0)}<Button size="sm" variant="ghost" onclick={() => run(() => api.post(`/integration_tasks/${tk.id}/actions/retry`, {}), t('integrations.retrying'))}>{t('integrations.retry')}</Button>{/if}
                  </Table.Cell>
                </Table.Row>
              {:else}
                <Table.Row><Table.Cell class="text-muted-foreground">{t('integrations.log_empty')}</Table.Cell></Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
        <div><Button variant="ghost" class="text-destructive" onclick={disconnect}>{t('integrations.disconnect')}</Button></div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
