<script lang="ts">
  import * as Sheet from '@openrent/ui/sheet';
  import * as Table from '@openrent/ui/table';
  import { Badge } from '@openrent/ui/badge';
  import { t, dt } from '#lib';

  /** One audit entry: who did what, and each changed field before and after. */
  let { entry = $bindable(null) }: { entry: any } = $props();

  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const changes = $derived.by(() => {
    const diff = entry?.diff ?? {};
    // Stored as { field: [before, after] }, or { created: {...} } / { deleted: {...} } for whole records.
    if (diff.created && typeof diff.created === 'object') return Object.entries(diff.created).map(([field, v]) => ({ field, before: undefined, after: v }));
    if (diff.deleted && typeof diff.deleted === 'object') return Object.entries(diff.deleted).map(([field, v]) => ({ field, before: v, after: undefined }));
    return Object.entries(diff).map(([field, v]: [string, any]) => (Array.isArray(v) && v.length === 2 ? { field, before: v[0], after: v[1] } : { field, before: undefined, after: v }));
  });
</script>

<Sheet.Root open={!!entry} onOpenChange={(o) => !o && (entry = null)}>
  <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
    {#if entry}
      <Sheet.Header>
        <Sheet.Title>{entry.entity_type} · {entry.action}</Sheet.Title>
        <Sheet.Description>{dt(entry.created_at)} · {entry.actor_name ?? entry.actor_id ?? t(`audit.actor.${entry.actor_type}` as any)}</Sheet.Description>
      </Sheet.Header>
      <div class="flex flex-col gap-4 px-4 pb-6 text-sm">
        <div class="flex flex-wrap gap-2">
          <Badge variant="outline" class="font-mono">{entry.entity_id}</Badge>
          {#if entry.ip}<Badge variant="secondary">{entry.ip}</Badge>{/if}
          {#if entry.request_id}<Badge variant="secondary" class="font-mono">{entry.request_id}</Badge>{/if}
        </div>
        {#if changes.length}
          <div class="rounded-lg border">
            <Table.Root>
              <Table.Header><Table.Row><Table.Head>{t('audit.field')}</Table.Head><Table.Head>{t('audit.before')}</Table.Head><Table.Head>{t('audit.after')}</Table.Head></Table.Row></Table.Header>
              <Table.Body>
                {#each changes as c (c.field)}
                  <Table.Row>
                    <Table.Cell class="font-mono text-xs">{c.field}</Table.Cell>
                    <Table.Cell class="text-muted-foreground max-w-48 text-xs break-all whitespace-normal">{show(c.before)}</Table.Cell>
                    <Table.Cell class="max-w-48 text-xs break-all whitespace-normal">{show(c.after)}</Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        {:else}
          <p class="text-muted-foreground">{t('audit.no_changes')}</p>
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
