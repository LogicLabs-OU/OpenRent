<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import { Progress } from '@openrent/ui/progress';
  import { api, t, getLocale } from '#lib';

  /** The shop's plan on a managed installation: what it uses against its limits. Hidden without limits. */
  let data = $state<{ limits: Record<string, number | null>; usage: { orders_this_month: number; storage_bytes: number; plugins_enabled: number } } | null>(null);
  onMount(async () => {
    data = await api.get('/tenant/usage').catch(() => null);
  });
  const num = (n: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(n);
  const rows = $derived(
    data
      ? ([
          ['orders_per_month', data.usage.orders_this_month, 'plan.orders'],
          ['storage_mb', data.usage.storage_bytes / 1024 / 1024, 'plan.storage'],
          ['plugins', data.usage.plugins_enabled, 'plan.plugins'],
        ] as const).filter(([k]) => typeof data!.limits[k] === 'number')
      : [],
  );
</script>

{#if rows.length}
  <Card.Root data-testid="plan-usage">
    <Card.Header>
      <Card.Title>{t('plan.title')}</Card.Title>
      <Card.Description>{t('plan.hint')}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      {#each rows as [key, used, label] (key)}
        {@const limit = data!.limits[key] as number}
        <div class="flex flex-col gap-1.5">
          <div class="flex justify-between text-sm"><span>{t(label)}</span><span class="text-muted-foreground tabular-nums">{t('plan.of', { used: num(used), limit: num(limit) })}</span></div>
          <Progress value={limit ? Math.min(100, (used / limit) * 100) : 100} aria-label={t(label)} />
        </div>
      {/each}
    </Card.Content>
  </Card.Root>
{/if}
