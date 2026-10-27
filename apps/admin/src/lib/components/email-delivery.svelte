<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import * as Dialog from '@openrent/ui/dialog';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import * as ToggleGroup from '@openrent/ui/toggle-group';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { StatusBadge } from '@openrent/ui/openrent';
  import { Badge } from '@openrent/ui/badge';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import SendIcon from '@lucide/svelte/icons/send';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import BanIcon from '@lucide/svelte/icons/ban';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import MailIcon from '@lucide/svelte/icons/mail';
  import { api, qs, t, toast, notifyError, rel, dt } from '#lib';
  import { to } from '#lib/nav.ts';

  /** Delivery status and actions for outgoing email (FR-NOT-5). `compact` shows only the summary. */
  let { compact = false }: { compact?: boolean } = $props();

  const FILTERS = ['all', 'queued', 'sent', 'failed', 'cancelled'] as const;
  let filter = $state<(typeof FILTERS)[number]>('all');
  let stats = $state<any>(null);
  let rows = $state<any[] | null>(null);
  let viewing = $state<any>(null);
  let busy = $state<string | null>(null);

  async function load() {
    try {
      stats = await api.get('/notifications/stats');
      if (!compact) rows = (await api.get(`/notifications?${qs({ status: filter === 'all' ? undefined : filter, limit: 100 })}`)).data;
    } catch (e) {
      notifyError(e);
    }
  }

  onMount(() => {
    load();
    // Keep the log current while messages are on their way.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && (stats?.counts.queued ?? 0) > 0) load();
    }, 10_000);
    return () => clearInterval(timer);
  });

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    busy = key;
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = null;
    }
  }

  const retryAll = (status: 'queued' | 'failed') =>
    act(`all:${status}`, async () => {
      const r = await api.post('/notifications/actions/retry_all', { status });
      if (!r.count) throw new Error(t('email.log.nothing_to_retry'));
    }, status === 'queued' ? t('email.log.sending_now') : t('email.log.failed_requeued'));

  async function view(n: any) {
    try {
      viewing = await api.get(`/notifications/${n.id}`);
    } catch (e) {
      notifyError(e);
    }
  }

  const canRetry = (n: any) => n.status === 'queued' || n.status === 'failed';
  const label = (s: string) => t(`status.${s}` as any);
</script>

{#snippet summary()}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each [['queued', stats.counts.queued], ['sent', stats.counts.sent + stats.counts.delivered], ['failed', stats.counts.failed + stats.counts.bounced], ['cancelled', stats.counts.cancelled]] as [s, n] (s)}
          <button
            type="button"
            class="hover:bg-muted/50 focus-visible:ring-ring/50 rounded-lg border p-3 text-left outline-none focus-visible:ring-3 aria-pressed:border-primary"
            aria-pressed={!compact && filter === s}
            onclick={() => {
              if (compact) return;
              filter = filter === s ? 'all' : (s as typeof filter);
              load();
            }}
          >
            <div class="text-muted-foreground text-xs">{label(s as string)}</div>
            <div class="text-2xl font-semibold tabular-nums">{n}</div>
          </button>
        {/each}
      </div>
      {#if stats.last_error && (stats.counts.queued || stats.counts.failed)}
        <Alert.Root variant="destructive">
          <CircleAlertIcon />
          <Alert.Title>{t('email.log.last_error', { when: rel(stats.last_error.at) })}</Alert.Title>
          <Alert.Description class="[overflow-wrap:anywhere]">{stats.last_error.message}</Alert.Description>
        </Alert.Root>
      {/if}
      <div class="flex flex-wrap gap-2">
        <Button size="sm" disabled={!stats.counts.queued || !!busy} onclick={() => retryAll('queued')}>
          {#if busy === 'all:queued'}<Spinner />{:else}<SendIcon />{/if}{t('email.log.send_waiting', { count: stats.counts.queued })}
        </Button>
        <Button size="sm" variant="outline" disabled={!stats.counts.failed || !!busy} onclick={() => retryAll('failed')}>
          {#if busy === 'all:failed'}<Spinner />{:else}<RotateCcwIcon />{/if}{t('email.log.retry_failed', { count: stats.counts.failed })}
        </Button>
        {#if compact}<Button size="sm" variant="ghost" href={to('/settings?tab=email')}>{t('email.log.open')}</Button>{/if}
      </div>

      {#if !compact}
        <ToggleGroup.Root type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => { if (v) { filter = v as typeof filter; load(); } }} aria-label={t('email.log.filter')}>
          {#each FILTERS as f (f)}<ToggleGroup.Item value={f}>{f === 'all' ? t('orders.tab.all') : label(f)}</ToggleGroup.Item>{/each}
        </ToggleGroup.Root>
        {#if rows && !rows.length}
          <Empty.Root class="border">
            <Empty.Header>
              <Empty.Media variant="icon"><MailIcon /></Empty.Media>
              <Empty.Title>{t('email.log.empty')}</Empty.Title>
            </Empty.Header>
          </Empty.Root>
        {:else if rows}
          <div class="rounded-lg border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>{t('email.log.col.message')}</Table.Head>
                  <Table.Head>{t('email.log.col.status')}</Table.Head>
                  <Table.Head class="hidden md:table-cell">{t('email.log.col.when')}</Table.Head>
                  <Table.Head class="w-10"><span class="sr-only">{t('common.more_actions')}</span></Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each rows as n (n.id)}
                  <Table.Row data-testid="email-row">
                    <Table.Cell class="max-w-0 min-w-56 whitespace-normal">
                      <button type="button" class="block w-full truncate text-left font-medium hover:underline" onclick={() => view(n)}>{#if n.channel !== 'email'}<Badge variant="outline" class="mr-1.5">{t(`email.channel.${n.channel}` as any)}</Badge>{/if}{n.subject || n.text}</button>
                      <div class="text-muted-foreground truncate text-xs">{n.recipient} · {t(`email.event.${n.template}` as any)}</div>
                      {#if n.error && canRetry(n)}<div class="text-destructive line-clamp-2 text-xs [overflow-wrap:anywhere]" title={n.error}>{n.error}</div>{/if}
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge status={n.status} label={label(n.status)} />
                      {#if n.status === 'queued' && n.next_attempt_at}<div class="text-muted-foreground mt-1 text-xs">{t('email.log.next_try', { when: rel(n.next_attempt_at) })}</div>{/if}
                      {#if n.attempts > 1}<div class="text-muted-foreground text-xs">{t('email.log.attempts', { count: n.attempts })}</div>{/if}
                    </Table.Cell>
                    <Table.Cell class="text-muted-foreground hidden text-xs md:table-cell" title={dt(n.sent_at ?? n.created_at)}>{rel(n.sent_at ?? n.created_at)}</Table.Cell>
                    <Table.Cell>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                          {#snippet child({ props })}<Button variant="ghost" size="icon-sm" aria-label={t('common.more_actions')} {...props}><EllipsisIcon /></Button>{/snippet}
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="end">
                          <DropdownMenu.Item onSelect={() => view(n)}><EyeIcon />{t('email.log.view')}</DropdownMenu.Item>
                          {#if canRetry(n)}
                            <DropdownMenu.Item onSelect={() => act(n.id, () => api.post(`/notifications/${n.id}/actions/retry`), t('email.log.retrying'))}><SendIcon />{t('email.log.retry')}</DropdownMenu.Item>
                          {/if}
                          {#if n.status !== 'queued'}
                            <DropdownMenu.Item onSelect={() => act(n.id, () => api.post(`/notifications/${n.id}/actions/resend`), t('email.log.resent', { to: n.recipient }))}><CopyIcon />{t('email.log.resend')}</DropdownMenu.Item>
                          {/if}
                          {#if n.order_id}
                            <DropdownMenu.Item onSelect={() => (location.href = to(`/orders/${n.order_id}`))}><ExternalLinkIcon />{t('email.log.open_order')}</DropdownMenu.Item>
                          {/if}
                          {#if canRetry(n)}
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item variant="destructive" onSelect={() => act(n.id, () => api.post(`/notifications/${n.id}/actions/cancel`), t('email.log.cancelled'))}><BanIcon />{t('email.log.cancel')}</DropdownMenu.Item>
                          {/if}
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        {/if}
      {/if}
{/snippet}

{#if stats && compact}
  <div class="flex flex-col gap-4" data-testid="email-delivery">{@render summary()}</div>
{:else if stats}
  <Card.Root data-testid="email-delivery">
    <Card.Header>
      <Card.Title>{t('email.log.title')}</Card.Title>
      <Card.Description>
        {t('email.log.hint')}
        {#if stats.last_sent_at}{' '}{t('email.log.last_sent', { when: rel(stats.last_sent_at) })}{/if}
      </Card.Description>
      <Card.Action>
        <Button variant="ghost" size="icon-sm" aria-label={t('email.log.refresh')} title={t('email.log.refresh')} onclick={load}><RefreshCwIcon /></Button>
      </Card.Action>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">{@render summary()}</Card.Content>
  </Card.Root>
{/if}

<Dialog.Root open={!!viewing} onOpenChange={(o) => !o && (viewing = null)}>
  <Dialog.Content class="sm:max-w-2xl">
    {#if viewing}
      <Dialog.Header>
        <Dialog.Title class="pr-6">{viewing.subject || t(`email.channel.${viewing.channel}` as any)}</Dialog.Title>
        <Dialog.Description>{t('email.log.to', { to: viewing.recipient })} · {dt(viewing.sent_at ?? viewing.created_at)}</Dialog.Description>
      </Dialog.Header>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={viewing.status} label={label(viewing.status)} />
        {#if viewing.attempts}<span class="text-muted-foreground">{t('email.log.attempts', { count: viewing.attempts })}</span>{/if}
        {#if viewing.attachments.length}<span class="text-muted-foreground">{t('email.log.attachments', { count: viewing.attachments.length })}</span>{/if}
      </div>
      {#if viewing.error && canRetry(viewing)}
        <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Description class="[overflow-wrap:anywhere]">{viewing.error}</Alert.Description></Alert.Root>
      {/if}
      {#if viewing.channel === 'email'}
        {#if viewing.content_hidden}
          <p class="text-muted-foreground text-sm" data-testid="email-content-hidden">{t('email.content_hidden')}</p>
        {:else}
          <iframe title={t('email.preview')} sandbox="" class="h-96 w-full rounded-md border bg-white" srcdoc={viewing.body_html}></iframe>
        {/if}
      {:else}
        <p class="rounded-md border p-3 text-sm whitespace-pre-wrap" data-testid="text-message-body">{viewing.content_hidden ? t('email.content_hidden') : viewing.text}</p>
      {/if}
      <Dialog.Footer>
        {#if canRetry(viewing)}
          <Button onclick={() => { const id = viewing.id; viewing = null; act(id, () => api.post(`/notifications/${id}/actions/retry`), t('email.log.retrying')); }}><SendIcon />{t('email.log.retry')}</Button>
        {:else}
          <Button variant="outline" onclick={() => { const id = viewing.id; const to_ = viewing.recipient; viewing = null; act(id, () => api.post(`/notifications/${id}/actions/resend`), t('email.log.resent', { to: to_ })); }}><CopyIcon />{t('email.log.resend')}</Button>
        {/if}
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
