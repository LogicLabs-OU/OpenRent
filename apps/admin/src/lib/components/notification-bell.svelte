<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Popover from '@openrent/ui/popover';
  import * as Dialog from '@openrent/ui/dialog';
  import * as Table from '@openrent/ui/table';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import BellIcon from '@lucide/svelte/icons/bell';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import CheckCheckIcon from '@lucide/svelte/icons/check-check';
  import { api, t, rel, notifyError, toast } from '#lib';
  import { to } from '#lib/nav.ts';

  /** In-app notices for the signed-in member (FR-NOT-3); refreshed every minute and when the tab comes back. */
  let open = $state(false);
  let notices = $state<any[]>([]);
  let unread = $state(0);
  let prefsOpen = $state(false);
  let prefs = $state<{ kind: string; in_app: boolean; email: boolean }[]>([]);

  async function load() {
    const r = await api.get('/me/notifications?limit=20');
    notices = r.data;
    unread = r.unread_count;
  }

  onMount(() => {
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 60_000);
    const visible = () => document.visibilityState === 'visible' && load().catch(() => undefined);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  });

  const text = (n: any) => t(`staff_notice.${n.kind}` as any, n.params ?? {});
  const href = (n: any) => (n.entity_type === 'order' && n.entity_id ? to(`/orders/${n.entity_id}`) : n.params?.product_id ? to(`/products/${n.params.product_id}`) : n.entity_type === 'maintenance_ticket' ? to(`/maintenance?ticket=${n.entity_id}`) : n.entity_type === 'job' ? to('/settings') : n.kind === 'staff_webhook_disabled' ? to('/settings?tab=webhooks') : null);

  async function openNotice(n: any) {
    try {
      if (!n.read_at) {
        await api.post(`/me/notifications/${n.id}/actions/read`, {});
        n.read_at = new Date().toISOString();
        unread = Math.max(0, unread - 1);
      }
      const link = href(n);
      if (link) {
        open = false;
        await goto(link);
      }
    } catch (err) {
      notifyError(err);
    }
  }

  async function readAll() {
    try {
      await api.post('/me/notifications/actions/read_all', {});
      await load();
    } catch (err) {
      notifyError(err);
    }
  }

  async function showPrefs() {
    try {
      prefs = (await api.get('/me/notification_preferences')).kinds;
      open = false;
      prefsOpen = true;
    } catch (err) {
      notifyError(err);
    }
  }

  async function setPref(kind: string, field: 'in_app' | 'email', value: boolean) {
    try {
      prefs = (await api.patch('/me/notification_preferences', { kinds: [{ kind, [field]: value }] })).kinds;
      toast.success(t('common.saved'));
    } catch (err) {
      notifyError(err);
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" class="relative" data-testid="notification-bell">
        <BellIcon />
        <!-- The name includes the visible count, so speech input users can say what they see. -->
        <span class="sr-only">{t('staff_notice.bell')}</span>
        {#if unread}<span class="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white tabular-nums" data-testid="notification-count">{unread > 99 ? '99+' : unread}</span>{/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-96 p-0">
    <div class="flex items-center justify-between border-b px-4 py-2">
      <span class="text-sm font-medium">{t('staff_notice.title')}</span>
      <div class="flex gap-1">
        <Button variant="ghost" size="icon" class="size-8" disabled={!unread} onclick={readAll} aria-label={t('staff_notice.read_all')} title={t('staff_notice.read_all')}><CheckCheckIcon /></Button>
        <Button variant="ghost" size="icon" class="size-8" onclick={showPrefs} aria-label={t('staff_notice.preferences')} title={t('staff_notice.preferences')} data-testid="notification-preferences"><SettingsIcon /></Button>
      </div>
    </div>
    <div class="max-h-96 overflow-y-auto">
      {#each notices as n (n.id)}
        <button type="button" class="hover:bg-muted/60 flex w-full gap-3 border-b px-4 py-3 text-left last:border-b-0" onclick={() => openNotice(n)} data-testid="notification-item">
          <span class={['mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary']}></span>
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class={['text-sm', !n.read_at && 'font-medium']}>{text(n)}</span>
            <span class="text-muted-foreground text-xs">{rel(n.created_at)}</span>
          </span>
        </button>
      {:else}
        <p class="text-muted-foreground px-4 py-8 text-center text-sm">{t('staff_notice.empty')}</p>
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>

<Dialog.Root bind:open={prefsOpen}>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>{t('staff_notice.preferences')}</Dialog.Title>
      <Dialog.Description>{t('staff_notice.preferences_hint')}</Dialog.Description>
    </Dialog.Header>
    <Table.Root>
      <Table.Header>
        <Table.Row><Table.Head></Table.Head><Table.Head class="w-24 text-center">{t('staff_notice.in_app')}</Table.Head><Table.Head class="w-24 text-center">{t('staff_notice.by_email')}</Table.Head></Table.Row>
      </Table.Header>
      <Table.Body>
        {#each prefs as p (p.kind)}
          <Table.Row data-testid="notification-pref">
            <Table.Cell>{t(`staff_notice.kind.${p.kind}` as any)}</Table.Cell>
            <Table.Cell class="text-center"><Switch checked={p.in_app} onCheckedChange={(v) => setPref(p.kind, 'in_app', v)} aria-label={`${t(`staff_notice.kind.${p.kind}` as any)}: ${t('staff_notice.in_app')}`} /></Table.Cell>
            <Table.Cell class="text-center"><Switch checked={p.email} onCheckedChange={(v) => setPref(p.kind, 'email', v)} aria-label={`${t(`staff_notice.kind.${p.kind}` as any)}: ${t('staff_notice.by_email')}`} /></Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </Dialog.Content>
</Dialog.Root>
