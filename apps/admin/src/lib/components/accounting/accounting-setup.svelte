<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, d } from '#lib';

  /**
   * Setting up the accounting system, step by step: which system, its app credentials, signing in, the
   * organisation, mapping OpenRent's accounts and tax rates to the organisation's own (picked from its
   * lists), and starting to send.
   */
  let { systems, connection, redirectUri, onchange }: { systems: any[]; connection: any; redirectUri: string; onchange: () => Promise<void> } = $props();
  let chosen = $state<string>('');
  let app = $state<Record<string, string>>({});
  let appErrors = $state<Record<string, string>>({});
  let busy = $state('');
  let lookups = $state<any>(null);
  let check = $state<any>(null);
  let mapping = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});
  let from = $state(new Date().toISOString().slice(0, 10));
  const system = $derived(connection ? systems.find((s) => s.id === connection.provider_id) : systems.find((s) => s.id === chosen));
  const live = $derived(connection && ['connected', 'error'].includes(connection.status));

  $effect(() => {
    if (live && !lookups) loadLists(false);
  });

  async function loadLists(refresh: boolean) {
    try {
      busy = 'lists';
      lookups = await api.get(`/accounting/connection/lookups${refresh ? '?refresh=true' : ''}`);
      check = await api.get('/accounting/connection/check');
      mapping = { ...(connection.settings?.mapping ?? {}) };
      // Tax rates the shop uses are matched by rate when nothing is chosen yet.
      for (const rate of check.rates ?? []) {
        if (!mapping[`taxes.${rate}`]) {
          const match = (lookups.taxRates ?? []).find((x: any) => x.rateBp === rate);
          if (match) mapping[`taxes.${rate}`] = match.id;
        }
      }
      errors = Object.fromEntries((check.errors ?? []).filter((e: any) => e.code !== 'required').map((e: any) => [e.field.replace(/^mapping\./, ''), e.message]));
    } catch (e) {
      notifyError(e);
    } finally {
      busy = '';
    }
  }

  async function saveApp(e: SubmitEvent) {
    e.preventDefault();
    busy = 'app';
    appErrors = {};
    try {
      const config = Object.fromEntries(Object.entries(app).filter(([, v]) => v !== ''));
      await api.post(`/accounting/systems/${system.id}/app`, { config });
      app = {};
      toast.success(t('common.saved'));
      await onchange();
    } catch (err) {
      appErrors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^config\./, ''), v]));
      if (!Object.keys(appErrors).length) notifyError(err);
    } finally {
      busy = '';
    }
  }

  async function connect() {
    busy = 'connect';
    try {
      // The system's sign-in page; it sends the shop back to this page.
      location.href = (await api.post(`/accounting/systems/${system.id}/connect`, {})).authorize_url;
    } catch (e) {
      notifyError(e);
      busy = '';
    }
  }

  async function chooseOrganisation(id: string) {
    try {
      await api.post('/accounting/connection/actions/choose_organisation', { organisation_id: id });
      lookups = null;
      await onchange();
    } catch (e) {
      notifyError(e);
    }
  }

  async function saveMapping(e: SubmitEvent) {
    e.preventDefault();
    busy = 'mapping';
    errors = {};
    try {
      await api.put('/accounting/connection/mapping', { mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v || null])) });
      check = await api.get('/accounting/connection/check');
      toast.success(t('common.saved'));
      await onchange();
    } catch (err) {
      errors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^mapping\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = '';
    }
  }

  async function start() {
    busy = 'start';
    errors = {};
    try {
      const r = await api.post('/accounting/connection/actions/start_sync', { from });
      toast.success(t('accounting.started', { count: r.queued }));
      await onchange();
    } catch (err) {
      errors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^mapping\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = '';
    }
  }

  async function pause() {
    try {
      await api.post('/accounting/connection/actions/pause_sync', {});
      await onchange();
    } catch (e) {
      notifyError(e);
    }
  }

  async function disconnect() {
    if (!(await confirmAction({ title: t('integrations.disconnect_title', { name: connection.provider_name }), description: t('accounting.disconnect_description'), confirmLabel: t('integrations.disconnect'), destructive: true }))) return;
    try {
      await api.del('/accounting/connection');
      lookups = null;
      await onchange();
    } catch (e) {
      notifyError(e);
    }
  }

  /** Remote records that fit a slot (by the system's own type), as "code — name". */
  const options = (slot: any) => ((lookups?.[slot.list] ?? []) as any[]).filter((x) => !slot.types?.length || !x.type || slot.types.includes(x.type));
  const label = (x: any) => (x.code ? `${x.code} — ${x.name}` : x.name);
</script>

<div class="flex max-w-4xl flex-col gap-6" data-testid="accounting-setup">
  <!-- 1. The system -->
  <Card.Root>
    <Card.Header><Card.Title>{t('accounting.step_system')}</Card.Title><Card.Description>{t('accounting.step_system_hint')}</Card.Description></Card.Header>
    <Card.Content>
      {#if connection}
        <p class="text-sm">{t('accounting.connected_to', { name: connection.provider_name, account: connection.account_name ?? '—' })}</p>
      {:else if !systems.length}
        <p class="text-muted-foreground text-sm">{t('accounting.no_systems')}</p>
      {:else}
        <div class="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t('accounting.step_system')}>
          {#each systems as s (s.id)}
            <button type="button" role="radio" aria-checked={chosen === s.id} class={['hover:bg-accent rounded-lg border p-4 text-left', chosen === s.id && 'border-primary ring-primary/30 ring-2']} onclick={() => (chosen = s.id)} data-system={s.id}>
              <span class="font-medium">{s.name}</span>
              <span class="text-muted-foreground block text-xs">{s.enabled ? (s.ready ? t('accounting.ready_to_connect') : t('accounting.needs_app')) : t('integrations.plugin_off_hint')}</span>
            </button>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if system && !connection}
    <!-- 2. App credentials and signing in -->
    <Card.Root>
      <Card.Header><Card.Title>{t('accounting.step_connect', { name: system.name })}</Card.Title><Card.Description>{t('accounting.step_connect_hint', { name: system.name })}</Card.Description></Card.Header>
      <Card.Content class="flex flex-col gap-4">
        <Field.Field>
          <Field.Label for="acc-redirect">{t('accounting.redirect_uri')}</Field.Label>
          <div class="flex gap-2">
            <Input id="acc-redirect" readonly value={redirectUri} class="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" aria-label={t('sso.copy')} onclick={() => navigator.clipboard.writeText(redirectUri).then(() => toast.success(t('sso.copied')))}><CopyIcon /></Button>
          </div>
          <Field.Description>{t('accounting.redirect_hint', { name: system.name })}</Field.Description>
        </Field.Field>
        <form class="flex flex-col gap-3" onsubmit={saveApp} novalidate>
          <Field.Group class="grid gap-3 sm:grid-cols-2">
            {#each system.app_fields as f (f.key)}
              <Field.Field data-invalid={!!appErrors[f.key] || undefined}>
                <Field.Label for={`acc-app-${f.key}`}>{f.label}</Field.Label>
                {#if f.type === 'select'}
                  <NativeSelect.Root id={`acc-app-${f.key}`} class="w-full" bind:value={app[f.key]}><NativeSelect.Option value="">—</NativeSelect.Option>{#each f.options ?? [] as o (o)}<NativeSelect.Option value={o}>{o}</NativeSelect.Option>{/each}</NativeSelect.Root>
                {:else}
                  <Input id={`acc-app-${f.key}`} type={f.type === 'secret' ? 'password' : 'text'} autocomplete="off" placeholder={system.ready ? t('accounting.kept') : ''} bind:value={app[f.key]} aria-invalid={!!appErrors[f.key]} />
                {/if}
                {#if appErrors[f.key]}<Field.Error>{appErrors[f.key]}</Field.Error>{:else if f.help}<Field.Description>{f.help}</Field.Description>{/if}
              </Field.Field>
            {/each}
          </Field.Group>
          <div><Button type="submit" variant="outline" disabled={busy === 'app'}>{#if busy === 'app'}<Spinner />{/if}{t('accounting.save_app')}</Button></div>
        </form>
      </Card.Content>
      <Card.Footer><Button disabled={!system.ready || !system.enabled || busy === 'connect'} onclick={connect}>{#if busy === 'connect'}<Spinner />{/if}{t('accounting.sign_in_with', { name: system.name })}</Button></Card.Footer>
    </Card.Root>
  {/if}

  {#if connection && live}
    <!-- 3. The organisation -->
    {#if connection.organisations.length > 1}
      <Card.Root>
        <Card.Header><Card.Title>{t('accounting.step_organisation')}</Card.Title><Card.Description>{t('accounting.step_organisation_hint')}</Card.Description></Card.Header>
        <Card.Content>
          <Field.Field class="max-w-sm">
            <Field.Label for="acc-org">{t('accounting.organisation')}</Field.Label>
            <NativeSelect.Root id="acc-org" class="w-full" value={connection.organisation_id ?? ''} onchange={(e) => chooseOrganisation((e.currentTarget as HTMLSelectElement).value)}>
              {#each connection.organisations as o (o.id)}<NativeSelect.Option value={o.id}>{o.name}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
            <Field.Description>{t('accounting.organisation_hint')}</Field.Description>
          </Field.Field>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- 4. The mapping -->
    <Card.Root>
      <Card.Header>
        <Card.Title>{t('accounting.step_mapping')}</Card.Title>
        <Card.Description>{t('accounting.step_mapping_hint', { name: connection.provider_name })}</Card.Description>
        <Card.Action><Button variant="outline" size="sm" disabled={busy === 'lists'} onclick={() => loadLists(true)}>{#if busy === 'lists'}<Spinner />{:else}<RefreshCwIcon />{/if}{t('accounting.refresh_lists')}</Button></Card.Action>
      </Card.Header>
      <Card.Content>
        {#if !lookups}
          <p class="text-muted-foreground text-sm">{t('common.loading')}</p>
        {:else}
          <form class="flex flex-col gap-6" onsubmit={saveMapping} novalidate data-testid="accounting-mapping">
            <Field.Group class="grid gap-4 sm:grid-cols-2">
              {#each system?.mapping ?? [] as slot (slot.key)}
                <Field.Field data-invalid={!!errors[slot.key] || undefined}>
                  <Field.Label for={`map-${slot.key}`}>{t(`accounting.slot.${slot.key}` as any)}{#if slot.required}<Badge variant="outline" class="ml-1">{t('accounting.required')}</Badge>{/if}</Field.Label>
                  <NativeSelect.Root id={`map-${slot.key}`} class="w-full" bind:value={mapping[slot.key]} aria-invalid={!!errors[slot.key]}>
                    <NativeSelect.Option value="">{slot.required ? t('accounting.choose') : t('accounting.fallback')}</NativeSelect.Option>
                    {#each options(slot) as x (x.id)}<NativeSelect.Option value={x.id}>{label(x)}</NativeSelect.Option>{/each}
                  </NativeSelect.Root>
                  {#if errors[slot.key]}<Field.Error>{errors[slot.key]}</Field.Error>{/if}
                </Field.Field>
              {/each}
            </Field.Group>
            {#if system?.maps_taxes}
              <div class="flex flex-col gap-3">
                <h3 class="text-sm font-medium">{t('accounting.taxes')}</h3>
                <Field.Group class="grid gap-4 sm:grid-cols-2">
                  {#each check?.rates ?? [] as rate (rate)}
                    {@const key = `taxes.${rate}`}
                    <Field.Field data-invalid={!!errors[key] || undefined}>
                      <Field.Label for={`map-${key}`}>{t('accounting.tax_rate', { rate: rate / 100 })}</Field.Label>
                      <NativeSelect.Root id={`map-${key}`} class="w-full" bind:value={mapping[key]} aria-invalid={!!errors[key]}>
                        <NativeSelect.Option value="">{t('accounting.choose')}</NativeSelect.Option>
                        {#each lookups.taxRates ?? [] as x (x.id)}<NativeSelect.Option value={x.id}>{x.name}</NativeSelect.Option>{/each}
                      </NativeSelect.Root>
                      {#if errors[key]}<Field.Error>{errors[key]}</Field.Error>{/if}
                    </Field.Field>
                  {/each}
                </Field.Group>
              </div>
            {/if}
            {#if errors.currency}<Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{errors.currency}</Alert.Title></Alert.Root>{/if}
            <div><Button type="submit" variant="outline" disabled={busy === 'mapping'}>{#if busy === 'mapping'}<Spinner />{/if}{t('accounting.save_mapping')}</Button></div>
          </form>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- 5. Sending -->
    <Card.Root>
      <Card.Header><Card.Title>{t('accounting.step_start')}</Card.Title><Card.Description>{t('accounting.step_start_hint')}</Card.Description></Card.Header>
      <Card.Content>
        {#if connection.sync_enabled}
          <p class="text-sm" data-testid="accounting-sending">{t('accounting.sending_since', { date: d(connection.sync_from) })}</p>
        {:else}
          <Field.Field class="max-w-xs" data-invalid={!!errors.from || undefined}>
            <Field.Label for="acc-from">{t('accounting.send_from')}</Field.Label>
            <Input id="acc-from" type="date" bind:value={from} aria-invalid={!!errors.from} />
            {#if errors.from}<Field.Error>{errors.from}</Field.Error>{:else}<Field.Description>{t('accounting.send_from_hint')}</Field.Description>{/if}
          </Field.Field>
        {/if}
      </Card.Content>
      <Card.Footer class="flex flex-wrap gap-2">
        {#if connection.status === 'error'}<Button disabled={busy === 'connect'} onclick={connect}>{#if busy === 'connect'}<Spinner />{/if}{t('accounting.reconnect')}</Button>{/if}
        {#if connection.sync_enabled}<Button variant="outline" onclick={pause}>{t('accounting.pause')}</Button>
        {:else}<Button disabled={busy === 'start' || busy === 'lists' || !lookups} onclick={start}>{#if busy === 'start'}<Spinner />{/if}{t('accounting.start')}</Button>{/if}
        <Button variant="ghost" class="text-destructive ml-auto" onclick={disconnect}>{t('integrations.disconnect')}</Button>
      </Card.Footer>
    </Card.Root>
  {:else if connection}
    <Card.Root>
      <Card.Header><Card.Title>{t('accounting.connecting')}</Card.Title><Card.Description>{connection.last_error ?? t('accounting.connecting_hint')}</Card.Description></Card.Header>
      <Card.Footer class="flex gap-2"><Button onclick={() => { chosen = connection.provider_id; connect(); }}>{t('accounting.sign_in_with', { name: connection.provider_name })}</Button><Button variant="ghost" onclick={disconnect}>{t('integrations.disconnect')}</Button></Card.Footer>
    </Card.Root>
  {/if}
</div>
