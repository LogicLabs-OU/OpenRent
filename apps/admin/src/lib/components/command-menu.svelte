<script lang="ts">
  import { goto } from '$app/navigation';
  import * as Command from '@openrent/ui/command';
  import { api, session, t } from '#lib';
  import { NAV, NAV_CONFIGURE, to } from '#lib/nav.ts';
  import { StatusBadge } from '@openrent/ui/openrent';
  import PlusIcon from '@lucide/svelte/icons/plus';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let q = $state('');
  let results = $state<any>(null);
  let timer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const term = q.trim();
    clearTimeout(timer);
    if (!term) {
      results = null;
      return;
    }
    timer = setTimeout(async () => {
      results = await api.get(`/search?q=${encodeURIComponent(term)}`).catch(() => null);
    }, 150);
  });

  function go(href: string) {
    open = false;
    q = '';
    goto(to(href));
  }
</script>

<Command.Dialog bind:open shouldFilter={false} title={t('search.title')} description={t('search.placeholder')}>
  <Command.Input placeholder={t('search.placeholder')} bind:value={q} />
  <Command.List>
    <Command.Empty>{t('search.empty')}</Command.Empty>
    {#if results}
      {#if results.orders.length}
        <Command.Group heading={t('nav.orders')}>
          {#each results.orders as o (o.id)}
            <Command.Item value={o.id} onSelect={() => go(`/orders/${o.id}`)}>
              <span class="font-mono text-xs text-muted-foreground">#{o.number}</span>
              <span class="flex-1 truncate">{o.customer_name ?? t('order.walk_in')}</span>
              <StatusBadge status={o.status} label={t(`status.${o.status}` as any)} />
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}
      {#if results.customers.length}
        <Command.Group heading={t('nav.customers')}>
          {#each results.customers as c (c.id)}
            <Command.Item value={c.id} onSelect={() => go(`/customers/${c.id}`)}>
              <span class="flex-1 truncate">{c.name}</span><span class="text-xs text-muted-foreground">{c.email ?? c.phone ?? ''}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}
      {#if results.stock_items.length}
        <Command.Group heading={t('search.units')}>
          {#each results.stock_items as s (s.id)}
            <Command.Item value={s.id} onSelect={() => go(`/inventory?q=${encodeURIComponent(s.barcode)}`)}>
              <span class="font-mono text-xs">{s.barcode}</span><span class="flex-1 truncate">{s.product_name}</span>
              <StatusBadge status={s.status} label={t(`status.${s.status}` as any)} />
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}
      {#if results.products.length}
        <Command.Group heading={t('nav.products')}>
          {#each results.products as p (p.id)}
            <Command.Item value={p.id} onSelect={() => go(`/products/${p.id}`)}>{p.name}</Command.Item>
          {/each}
        </Command.Group>
      {/if}
    {:else}
      <Command.Group heading={t('search.actions')}>
        <Command.Item value="new-order" onSelect={() => go('/orders/new')}><PlusIcon />{t('action.new_order')}<Command.Shortcut>N</Command.Shortcut></Command.Item>
      </Command.Group>
      <Command.Group heading={t('search.pages')}>
        {#each [...NAV, ...NAV_CONFIGURE].filter((i) => !i.perm || session.can(i.perm)) as item (item.href)}
          <Command.Item value={item.href} onSelect={() => go(item.href)}><item.icon />{t(item.key)}</Command.Item>
        {/each}
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>
