<script lang="ts">
  import './layout.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ModeWatcher } from 'mode-watcher';
  import * as Sidebar from '@openrent/ui/sidebar';
  import * as Breadcrumb from '@openrent/ui/breadcrumb';
  import { Separator } from '@openrent/ui/separator';
  import { Button } from '@openrent/ui/button';
  import { Kbd } from '@openrent/ui/kbd';
  import { Toaster } from '@openrent/ui/sonner';
  import { Spinner } from '@openrent/ui/spinner';
  import SearchIcon from '@lucide/svelte/icons/search';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import type { LayoutProps } from './$types';
  import { api, session, t, notifyError } from '#lib';
  import { NAV, NAV_CONFIGURE, to, currentScanHandler } from '#lib/nav.ts';
  import { listenForScans, beep } from '#lib/scanner.ts';
  import AppSidebar from '#lib/components/app-sidebar.svelte';
  import CommandMenu from '#lib/components/command-menu.svelte';
  import ConfirmDialog from '#lib/components/confirm-dialog.svelte';
  import NotificationBell from '#lib/components/notification-bell.svelte';
  import LocationSwitcher from '#lib/components/location-switcher.svelte';

  let { children }: LayoutProps = $props();
  let palette = $state(false);
  let flash = $state('');

  const bare = $derived(/\/(login|setup)\/?$/.test(page.url.pathname));
  const section = $derived.by(() => {
    const p = page.url.pathname.replace(/^\/admin/, '') || '/';
    return [...NAV, ...NAV_CONFIGURE].find((n) => (n.href === '/' ? p === '/' : p.startsWith(n.href)));
  });
  const deeper = $derived((page.url.pathname.replace(/^\/admin/, '') || '/').split('/').filter(Boolean).length > 1);

  onMount(() => {
    (async () => {
      await session.load();
      if (!session.me && !bare) {
        const setup = await api.get('/setup').catch(() => ({ required: false }));
        goto(to(setup.required ? '/setup' : `/login?next=${encodeURIComponent(page.url.pathname)}`));
      }
    })();

    const stop = listenForScans(async (code) => {
      if (!session.me) return;
      const h = currentScanHandler();
      if (h && (await h(code))) return;
      try {
        const r = await api.post('/scans', { code, mode: 'lookup' });
        if (!r.entity_type) throw new Error(t('scan.not_found', { code }));
        beep(true);
        signal('ok');
        if (r.entity_type === 'order') goto(to(`/orders/${r.entity.id}`));
        else if (r.entity_type === 'stock_item') goto(to(r.entity.current_order_id ? `/orders/${r.entity.current_order_id}` : `/inventory?q=${encodeURIComponent(r.entity.barcode)}`));
        else if (r.entity_type === 'customer') goto(to(`/customers/${r.entity.id}`));
        else if (r.entity_type === 'stock_level') goto(to('/inventory?tab=bulk'));
      } catch (e) {
        beep(false);
        signal('err');
        notifyError(e);
      }
    });
    const keys = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        palette = true;
      }
      if (e.key === 'n' && !typing && !e.ctrlKey && !e.metaKey && !palette) goto(to('/orders/new'));
    };
    window.addEventListener('keydown', keys);
    return () => {
      stop();
      window.removeEventListener('keydown', keys);
    };
  });

  function signal(kind: 'ok' | 'err') {
    flash = '';
    requestAnimationFrame(() => (flash = kind === 'ok' ? 'scan-ok' : 'scan-err'));
  }
</script>

<svelte:head>
  <link rel="icon" href={to('/favicon.svg')} />
</svelte:head>

<ModeWatcher />
{#if bare}
  {@render children()}
{:else if !session.loaded || !session.me}
  <div class="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />{t('common.loading')}</div>
{:else}
  <Sidebar.Provider>
    <AppSidebar />
    <Sidebar.Inset class={flash}>
      <header class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Sidebar.Trigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb.Root class="hidden sm:block">
          <Breadcrumb.List>
            <Breadcrumb.Item>
              {#if deeper && section}
                <Breadcrumb.Link href={to(section.href)}>{t(section.key)}</Breadcrumb.Link>
              {:else}
                <Breadcrumb.Page>{section ? t(section.key) : 'OpenRent'}</Breadcrumb.Page>
              {/if}
            </Breadcrumb.Item>
            {#if deeper}
              <Breadcrumb.Separator />
              <Breadcrumb.Item><Breadcrumb.Page>{t('common.details')}</Breadcrumb.Page></Breadcrumb.Item>
            {/if}
          </Breadcrumb.List>
        </Breadcrumb.Root>
        <div class="ml-auto flex items-center gap-2">
          <LocationSwitcher />
          <Button variant="outline" size="sm" class="w-40 justify-between text-muted-foreground sm:w-64" onclick={() => (palette = true)}>
            <span class="flex items-center gap-2"><SearchIcon />{t('search.button')}</span><Kbd>/</Kbd>
          </Button>
          <NotificationBell />
          <Button size="sm" href={to('/orders/new')}><PlusIcon />{t('action.new_order')}</Button>
        </div>
      </header>
      <div class="flex-1 p-4 md:p-6">
        <div class="mx-auto w-full max-w-7xl">{@render children()}</div>
      </div>
    </Sidebar.Inset>
  </Sidebar.Provider>
  <CommandMenu bind:open={palette} />
  <ConfirmDialog />
{/if}
<Toaster richColors closeButton position="bottom-right" />
