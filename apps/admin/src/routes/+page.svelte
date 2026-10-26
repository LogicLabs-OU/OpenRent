<script lang="ts">
  import PluginSlot from '#lib/components/plugin-slot.svelte';
  import * as Card from '@openrent/ui/card';
  import * as Item from '@openrent/ui/item';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { StatusBadge, StatCard, PageHeader, formatMoney } from '@openrent/ui/openrent';
  import { api, qs, dt, rel, t, notifyError, session } from '#lib';
  import { to } from '#lib/nav.ts';
  import CancellationRequests from '#lib/components/cancellation-requests.svelte';
  import ExtensionRequests from '#lib/components/extension-requests.svelte';

  let data = $state<any>(null);
  // Follows the header's location switcher.
  $effect(() => {
    const location_id = session.locationId || undefined;
    api.get(`/reports/dashboard?${qs({ location_id })}`).then((r) => (data = r), notifyError);
  });
  const lists = $derived(
    data
      ? [
          { title: t('dashboard.pickups'), rows: data.pickups_today, when: 'starts_at' },
          { title: t('dashboard.returns'), rows: data.returns_today, when: 'ends_at' },
          { title: t('dashboard.attention'), rows: [...data.overdue, ...data.late_pickups], when: 'ends_at' },
        ]
      : [],
  );
</script>

<svelte:head><title>{t('nav.dashboard')} · OpenRent</title></svelte:head>

<PageHeader title={t('dashboard.title')} description={data ? dt(new Date(), undefined, { dateStyle: 'full' }) : undefined} />
<CancellationRequests />
<ExtensionRequests />

{#if data}
  <div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
    <StatCard label={t('dashboard.pickups')} value={data.pickups_today.length} />
    <StatCard label={t('dashboard.returns')} value={data.returns_today.length} />
    <StatCard label={t('dashboard.overdue')} value={data.overdue.length} tone={data.overdue.length ? 'danger' : 'default'} />
    <StatCard label={t('dashboard.open_quotes')} value={data.open_quotes} />
    <StatCard label={t('dashboard.units_out')} value={`${data.units.out} / ${data.units.total}`} hint={t('dashboard.utilisation', { pct: Math.round(data.units.utilization_now * 100) })} />
  </div>
  <div class="mt-4 grid gap-4 md:grid-cols-2">
    <StatCard label={t('dashboard.revenue_mtd')} value={formatMoney(data.revenue_mtd)} hint={t('dashboard.revenue_hint')} />
    <StatCard label={t('dashboard.booked_mtd')} value={formatMoney(data.booked_mtd)} hint={t('dashboard.booked_hint')} />
  </div>
  <div class="mt-4 grid gap-4 lg:grid-cols-3">
    {#each lists as list (list.title)}
      <Card.Root>
        <Card.Header><Card.Title>{list.title}</Card.Title><Card.Description>{t('dashboard.count', { count: list.rows.length })}</Card.Description></Card.Header>
        <Card.Content class="flex flex-col gap-2">
          {#each list.rows as o (o.id)}
            <Item.Root variant="outline" size="sm">
              {#snippet child({ props })}
                <a href={to(`/orders/${o.id}`)} {...props}>
                  <Item.Content>
                    <Item.Title><span class="font-mono text-xs text-muted-foreground">#{o.number}</span>{o.customer_name ?? t('order.walk_in')}</Item.Title>
                    <Item.Description title={dt(o[list.when])}>{rel(o[list.when])}</Item.Description>
                  </Item.Content>
                  <Item.Actions><StatusBadge status={o.status} label={t(`status.${o.status}` as any)} /></Item.Actions>
                </a>
              {/snippet}
            </Item.Root>
          {:else}
            <p class="py-6 text-center text-sm text-muted-foreground">{t('dashboard.nothing')}</p>
          {/each}
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
  <div class="mt-4 grid gap-4 lg:grid-cols-3"><PluginSlot slot="dashboard.widget" /></div>
{:else}
  <div class="grid grid-cols-2 gap-4 lg:grid-cols-5">{#each Array(5) as _}<Skeleton class="h-28 rounded-xl" />{/each}</div>
  <div class="mt-4 grid gap-4 lg:grid-cols-3">{#each Array(3) as _}<Skeleton class="h-64 rounded-xl" />{/each}</div>
{/if}
