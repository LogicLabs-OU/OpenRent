<script lang="ts">
  import { goto } from '$app/navigation';
  import * as Table from '@openrent/ui/table';
  import * as Empty from '@openrent/ui/empty';
  import * as InputGroup from '@openrent/ui/input-group';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { StatusBadge, PageHeader, formatMoney } from '@openrent/ui/openrent';
  import SearchIcon from '@lucide/svelte/icons/search';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PackageIcon from '@lucide/svelte/icons/package';
  import { api, qs, t, notifyError } from '#lib';
  import { to } from '#lib/nav.ts';
  import ImportExportMenu from '#lib/components/import-export-menu.svelte';

  let rows = $state<any[]>([]);
  let q = $state('');
  let type = $state('');
  let loading = $state(true);
  let timer: ReturnType<typeof setTimeout>;

  async function load() {
    loading = true;
    try {
      rows = (await api.get(`/products?${qs({ q, 'filter[type]': type, limit: 200 })}`)).data;
    } catch (e) {
      notifyError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void type;
    load();
  });
  const price = (v: any) => {
    const ps = v.price_structure;
    if (!ps) return '—';
    const m = formatMoney({ amount: ps.kind === 'table' ? ps.price_table?.[0]?.amount ?? 0 : ps.amount, currency: ps.currency });
    return ps.kind === 'fixed' ? m : t('product.price_per', { price: m, unit: t(`period.${ps.period_unit}` as any) });
  };
  const stock = (v: any) => (v.tracking === 'serialized' ? t('product.units', { count: v.stock?.units ?? 0 }) : v.tracking === 'bulk' ? t('product.in_stock', { count: v.stock?.quantity ?? 0 }) : '—');
</script>

<svelte:head><title>{t('nav.products')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.products')} description={t('products.description')}>
  {#snippet actions()}<ImportExportMenu entities={['products', 'prices']} onimported={load} /><Button href={to('/products/new')}><PlusIcon />{t('products.new')}</Button>{/snippet}
</PageHeader>

<div class="mb-4 flex flex-wrap items-center justify-end gap-3">
  <NativeSelect.Root bind:value={type} aria-label={t('field.type')}>
    <NativeSelect.Option value="">{t('products.all_types')}</NativeSelect.Option>
    {#each ['rental', 'bundle', 'sale', 'service', 'consumable'] as x}<NativeSelect.Option value={x}>{t(`product.type.${x}` as any)}</NativeSelect.Option>{/each}
  </NativeSelect.Root>
  <InputGroup.Root class="w-full sm:w-72">
    <InputGroup.Input placeholder={t('products.search')} bind:value={q} oninput={() => { clearTimeout(timer); timer = setTimeout(load, 200); }} aria-label={t('products.search')} />
    <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
  </InputGroup.Root>
</div>

{#if loading && !rows.length}
  <div class="space-y-2">{#each Array(6) as _}<Skeleton class="h-10 w-full" />{/each}</div>
{:else if rows.length}
  <div class="overflow-hidden rounded-lg border">
    <Table.Root>
      <Table.Header class="bg-muted/50">
        <Table.Row><Table.Head>{t('field.name')}</Table.Head><Table.Head>{t('field.type')}</Table.Head><Table.Head>{t('product.variants')}</Table.Head><Table.Head>{t('product.price')}</Table.Head><Table.Head>{t('product.stock')}</Table.Head><Table.Head>{t('product.visibility')}</Table.Head></Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as p (p.id)}
          <Table.Row class="cursor-pointer" onclick={() => goto(to(`/products/${p.id}`))}>
            <Table.Cell class="font-medium"><a href={to(`/products/${p.id}`)} class="hover:underline">{p.name}</a></Table.Cell>
            <Table.Cell><Badge variant="secondary">{t(`product.type.${p.type}` as any)}</Badge></Table.Cell>
            <Table.Cell class="text-muted-foreground">{p.variants.length > 1 ? p.variants.map((v: any) => v.name).join(', ') : t(`tracking.${p.variants[0]?.tracking ?? 'none'}` as any)}</Table.Cell>
            <Table.Cell>{p.type === 'bundle' ? (p.bundle?.pricing_mode === 'discount_pct' ? t('product.bundle_discount', { pct: p.bundle.discount_bp / 100 }) : t(`bundle.mode.${p.bundle?.pricing_mode ?? 'sum'}` as any)) : price(p.variants[0] ?? {})}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{p.variants.map(stock).join(' · ')}</Table.Cell>
            <Table.Cell><StatusBadge status={p.visibility} label={t(`visibility.${p.visibility}` as any)} /></Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{:else}
  <Empty.Root class="border border-dashed">
    <Empty.Header>
      <Empty.Media variant="icon"><PackageIcon /></Empty.Media>
      <Empty.Title>{t('products.empty_title')}</Empty.Title>
      <Empty.Description>{t('products.empty_description')}</Empty.Description>
    </Empty.Header>
    <Empty.Content><Button href={to('/products/new')}><PlusIcon />{t('products.new')}</Button></Empty.Content>
  </Empty.Root>
{/if}
