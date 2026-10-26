<script lang="ts">
  import { onMount } from 'svelte';
  import * as Tabs from '@openrent/ui/tabs';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { PageHeader } from '@openrent/ui/openrent';
  import { api, session, t, toast, notifyError } from '#lib';
  import Overview from '#lib/components/accounting/accounting-overview.svelte';
  import Setup from '#lib/components/accounting/accounting-setup.svelte';
  import Records from '#lib/components/accounting/accounting-records.svelte';
  import SyncLog from '#lib/components/accounting/accounting-log.svelte';
  import Journal from '#lib/components/accounting/accounting-journal.svelte';
  import Settings from '#lib/components/accounting/accounting-settings.svelte';

  /**
   * Accounting (FR-INT-3, ADR 0009): the shop's accounting system, what reached the books, the journal
   * and the accounting settings. The books themselves stay in the accounting system.
   */
  const TABS = ['overview', 'setup', 'records', 'log', 'journal', 'settings'] as const;
  const params = new URLSearchParams(location.search);
  let tab = $state<string>(params.get('tab') ?? (params.get('connected') ? 'setup' : 'overview'));
  let overview = $state<any>(null);
  let connection = $state<any>(null);
  let systems = $state<any[]>([]);
  let redirectUri = $state('');
  const canManage = $derived(session.can('accounting:manage'));
  const system = $derived(connection ? (systems.find((s) => s.id === connection.provider_id) ?? null) : null);

  async function load() {
    const [o, c, s] = await Promise.all([api.get('/accounting/overview'), api.get('/accounting/connection'), api.get('/accounting/systems')]);
    overview = o;
    connection = c;
    systems = s.data;
    redirectUri = s.redirect_uri;
  }
  onMount(() => {
    if (params.get('connected')) toast.success(t('accounting.connected_toast'));
    if (params.get('integration_error')) toast.error(t('integrations.connect_failed'));
    load().catch(notifyError);
  });
</script>

<svelte:head><title>{t('nav.accounting')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.accounting')} description={t('accounting.description')} />

{#if !overview}
  <Skeleton class="h-64 rounded-xl" />
{:else}
  <Tabs.Root bind:value={tab} class="gap-6">
    <Tabs.List class="h-auto flex-wrap justify-start">
      {#each TABS as x (x)}{#if canManage || !['setup', 'settings'].includes(x)}<Tabs.Trigger value={x}>{t(`accounting.tab.${x}` as any)}</Tabs.Trigger>{/if}{/each}
    </Tabs.List>
    <Tabs.Content value="overview"><Overview {overview} {connection} {canManage} onsetup={() => (tab = 'setup')} onrecords={(status) => { tab = 'records'; history.replaceState(null, '', `?tab=records&status=${status}`); }} /></Tabs.Content>
    {#if canManage}<Tabs.Content value="setup"><Setup {systems} {connection} {redirectUri} onchange={load} /></Tabs.Content>{/if}
    <!-- Lists load when their tab opens, so they show what was booked meanwhile. -->
    <Tabs.Content value="records">{#if tab === 'records'}<Records {connection} {canManage} />{/if}</Tabs.Content>
    <Tabs.Content value="log">{#if tab === 'log'}<SyncLog {connection} {canManage} />{/if}</Tabs.Content>
    <Tabs.Content value="journal">{#if tab === 'journal'}<Journal {canManage} />{/if}</Tabs.Content>
    {#if canManage}<Tabs.Content value="settings"><Settings {connection} {system} onchange={load} /></Tabs.Content>{/if}
  </Tabs.Root>
{/if}
