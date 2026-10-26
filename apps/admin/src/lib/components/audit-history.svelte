<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import { Button } from '@openrent/ui/button';
  import { api, qs, t, rel, dt, notifyError } from '#lib';
  import { to } from '#lib/nav.ts';
  import AuditDiff from './audit-diff.svelte';

  /** The latest audit entries of one record, with a link to the full log (FR-AUD-1). */
  let { entityType, entityId, limit = 8 }: { entityType: string; entityId: string; limit?: number } = $props();
  let rows = $state<any[]>([]);
  let open = $state<any>(null);

  $effect(() => {
    api.get(`/audit_log?${qs({ 'filter[entity_type]': entityType, 'filter[entity_id]': entityId, limit })}`).then((r) => (rows = r.data), notifyError);
  });
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{t('audit.history')}</Card.Title>
    <Card.Action><Button size="sm" variant="ghost" href={to(`/audit?${qs({ entity_type: entityType, entity_id: entityId })}`)}>{t('audit.view_all')}</Button></Card.Action>
  </Card.Header>
  <Card.Content>
    {#if rows.length}
      <ol class="flex flex-col gap-1 text-sm">
        {#each rows as a (a.id)}
          <li>
            <button type="button" class="hover:bg-muted flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left" onclick={() => (open = a)}>
              <span><span class="font-medium">{a.action}</span> <span class="text-muted-foreground">· {a.actor_name ?? t(`audit.actor.${a.actor_type}` as any)}</span></span>
              <span class="text-muted-foreground shrink-0 text-xs" title={dt(a.created_at)}>{rel(a.created_at)}</span>
            </button>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="text-muted-foreground text-sm">{t('audit.empty')}</p>
    {/if}
  </Card.Content>
</Card.Root>
<AuditDiff bind:entry={open} />
