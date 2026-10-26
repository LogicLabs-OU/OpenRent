<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import { Button } from '@openrent/ui/button';
  import { api, t, toast, notifyError, dt } from '#lib';
  import { to } from '#lib/nav.ts';

  /** Payments where OpenRent and the payment provider disagree (FR-PAY-7); found by the nightly check. */
  let issues = $state<any[]>([]);
  async function load() {
    issues = (await api.get('/payment_reconciliation_issues?open=true')).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });
  async function resolve(i: any) {
    try {
      await api.post(`/payment_reconciliation_issues/${i.id}/actions/resolve`, {});
      toast.success(t('reconciliation.resolved'));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<Card.Root data-testid="reconciliation">
  <Card.Header>
    <Card.Title>{t('reconciliation.title')}</Card.Title>
    <Card.Description>{t('reconciliation.hint')}</Card.Description>
  </Card.Header>
  <Card.Content>
    {#if issues.length}
      <Table.Root>
        <Table.Body>
          {#each issues as i (i.id)}
            <Table.Row>
              <Table.Cell>
                <div class="font-medium">{t(`reconciliation.kind.${i.kind}` as any)}</div>
                <div class="text-muted-foreground font-mono text-xs">{i.provider} · {i.provider_ref} · {dt(i.detected_at)}</div>
              </Table.Cell>
              <Table.Cell class="text-right whitespace-nowrap">
                {#if i.order_id}<Button size="sm" variant="ghost" href={to(`/orders/${i.order_id}`)}>{t('reconciliation.open_order')}</Button>{/if}
                <Button size="sm" variant="outline" onclick={() => resolve(i)}>{t('reconciliation.resolve')}</Button>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      <p class="text-muted-foreground text-sm">{t('reconciliation.none')}</p>
    {/if}
  </Card.Content>
</Card.Root>
