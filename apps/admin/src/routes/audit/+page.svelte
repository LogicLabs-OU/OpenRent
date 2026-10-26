<script lang="ts">
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { PageHeader } from '@openrent/ui/openrent';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
  import { api, qs, download, t, dt, rel, notifyError } from '#lib';
  import AuditDiff from '#lib/components/audit-diff.svelte';

  const ENTITIES = ['order', 'product', 'variant', 'stock_item', 'customer', 'tenant', 'tenant_settings', 'location', 'user', 'api_key', 'payment_provider', 'plugin', 'theme', 'import', 'document'];
  const q = page.url.searchParams;
  let filters = $state({ entity_type: q.get('entity_type') ?? '', entity_id: q.get('entity_id') ?? '', action: q.get('action') ?? '', from: '', to: '' });
  let rows = $state<any[] | null>(null);
  let cursor = $state<string | null>(null);
  let open = $state<any>(null);

  const query = () =>
    qs({
      'filter[entity_type]': filters.entity_type,
      'filter[entity_id]': filters.entity_id.trim(),
      'filter[action]': filters.action.trim(),
      'filter[created_at][gte]': filters.from ? new Date(filters.from).toISOString() : '',
      'filter[created_at][lte]': filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : '',
    });

  async function load(more = false) {
    try {
      const r = await api.get(`/audit_log?${query()}&limit=50${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      rows = more ? [...(rows ?? []), ...r.data] : r.data;
      cursor = r.has_more ? r.next_cursor : null;
    } catch (e) {
      notifyError(e);
    }
  }
  load();
</script>

<svelte:head><title>{t('nav.audit')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.audit')} description={t('audit.description')}>
  {#snippet actions()}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>{#snippet child({ props })}<Button variant="outline" {...props}><DownloadIcon />{t('audit.export')}</Button>{/snippet}</DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item onSelect={() => download(`/audit_log/export?${query()}&format=xlsx`).catch(notifyError)}>{t('import.export_xlsx')}</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => download(`/audit_log/export?${query()}`).catch(notifyError)}>{t('import.export_csv')}</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/snippet}
</PageHeader>

<Card.Root class="mb-6">
  <Card.Content>
    <form class="grid gap-4 sm:grid-cols-2 lg:grid-cols-6" onsubmit={(e) => { e.preventDefault(); load(); }}>
      <Field.Field>
        <Field.Label for="a-entity">{t('audit.entity')}</Field.Label>
        <NativeSelect id="a-entity" class="w-full" bind:value={filters.entity_type}>
          <NativeSelectOption value="">{t('audit.all_entities')}</NativeSelectOption>
          {#each ENTITIES as e (e)}<NativeSelectOption value={e}>{e}</NativeSelectOption>{/each}
        </NativeSelect>
      </Field.Field>
      <Field.Field><Field.Label for="a-id">{t('audit.entity_id')}</Field.Label><Input id="a-id" placeholder="ord_…" bind:value={filters.entity_id} /></Field.Field>
      <Field.Field><Field.Label for="a-action">{t('audit.action')}</Field.Label><!-- i18n-ignore --><Input id="a-action" placeholder="update" bind:value={filters.action} /></Field.Field>
      <Field.Field><Field.Label for="a-from">{t('inventory.from')}</Field.Label><Input id="a-from" type="date" bind:value={filters.from} /></Field.Field>
      <Field.Field><Field.Label for="a-to">{t('inventory.until')}</Field.Label><Input id="a-to" type="date" bind:value={filters.to} /></Field.Field>
      <div class="flex items-end"><Button type="submit" class="w-full">{t('audit.apply')}</Button></div>
    </form>
  </Card.Content>
</Card.Root>

{#if !rows}
  <Skeleton class="h-96 rounded-xl" />
{:else if !rows.length}
  <Empty.Root class="border">
    <Empty.Header><Empty.Media variant="icon"><ScrollTextIcon /></Empty.Media><Empty.Title>{t('audit.empty')}</Empty.Title></Empty.Header>
  </Empty.Root>
{:else}
  <div class="rounded-lg border" data-testid="audit-table">
    <Table.Root>
      <Table.Header>
        <Table.Row><Table.Head>{t('email.log.col.when')}</Table.Head><Table.Head>{t('audit.actor')}</Table.Head><Table.Head>{t('audit.entity')}</Table.Head><Table.Head>{t('audit.action')}</Table.Head><Table.Head class="w-20"></Table.Head></Table.Row>
      </Table.Header>
      <Table.Body>
        {#each rows as a (a.id)}
          <Table.Row class="cursor-pointer" onclick={() => (open = a)}>
            <Table.Cell class="text-muted-foreground text-xs" title={dt(a.created_at)}>{rel(a.created_at)}</Table.Cell>
            <Table.Cell>{a.actor_name ?? t(`audit.actor.${a.actor_type}` as any)}</Table.Cell>
            <Table.Cell><Badge variant="outline">{a.entity_type}</Badge> <span class="text-muted-foreground font-mono text-xs">{a.entity_id}</span></Table.Cell>
            <Table.Cell class="font-medium">{a.action}</Table.Cell>
            <Table.Cell class="text-right"><Button variant="ghost" size="sm" onclick={(e) => { e.stopPropagation(); open = a; }}>{t('email.log.view')}</Button></Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
  {#if cursor}<div class="mt-4 flex justify-center"><Button variant="outline" onclick={() => load(true)}>{t('common.load_more')}</Button></div>{/if}
{/if}
<AuditDiff bind:entry={open} />
