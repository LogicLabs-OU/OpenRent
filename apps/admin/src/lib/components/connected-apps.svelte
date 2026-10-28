<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import { Button } from '@openrent/ui/button';
  import AppWindowIcon from '@lucide/svelte/icons/app-window';
  import { api, t, toast, notifyError, rel, confirmAction } from '#lib';

  /** Apps connected to the shop with OAuth (PRD §5.2): what each may do; disconnecting stops it at once. */
  let grants = $state<any[]>([]);

  async function load() {
    try {
      grants = (await api.get('/oauth_grants')).data;
    } catch (e) {
      notifyError(e);
    }
  }
  onMount(load);

  async function disconnect(g: any) {
    if (!(await confirmAction({ title: t('oauth.disconnect_title', { app: g.app_name }), description: t('oauth.disconnect_description'), confirmLabel: t('oauth.disconnect'), destructive: true }))) return;
    try {
      await api.del(`/oauth_grants/${g.id}`);
      toast.success(t('oauth.disconnected'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<Card.Root data-testid="connected-apps">
  <Card.Header>
    <Card.Title>{t('settings.tab.apps')}</Card.Title>
    <Card.Description>{t('oauth.apps_description')}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if grants.length}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{t('oauth.app')}</Table.Head>
            <Table.Head>{t('oauth.scopes')}</Table.Head>
            <Table.Head>{t('oauth.approved_by')}</Table.Head>
            <Table.Head>{t('calendar.last_used')}</Table.Head>
            <Table.Head class="w-28"><span class="sr-only">{t('oauth.disconnect')}</span></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each grants as g (g.id)}
            <Table.Row data-testid="connected-app">
              <Table.Cell class="font-medium">{#if g.homepage}<a class="hover:underline" href={g.homepage} rel="noopener noreferrer" target="_blank">{g.app_name}</a>{:else}{g.app_name}{/if}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-xs">{g.scopes.join(', ')}</Table.Cell>
              <Table.Cell class="text-sm">{g.approved_by ?? '–'}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-sm">{g.last_used_at ? rel(g.last_used_at) : t('calendar.never')}</Table.Cell>
              <Table.Cell class="text-right"><Button size="sm" variant="ghost" onclick={() => disconnect(g)}>{t('oauth.disconnect')}</Button></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      <p class="text-muted-foreground flex items-center gap-2 text-sm"><AppWindowIcon class="size-4" />{t('oauth.no_apps')}</p>
    {/if}
  </Card.Content>
</Card.Root>
