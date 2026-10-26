<script lang="ts">
  import { getRuntime, type OrderConfirmationData } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';

  /** Damage found after the return, with the shop's photos (theme API 1.4). */
  let { charges, orderToken }: { charges: OrderConfirmationData['order']['damage_charges']; orderToken: string } = $props();
  const rt = getRuntime();
</script>

{#if charges?.length}
  <Card.Root data-testid="order-damage">
    <Card.Header>
      <Card.Title >{rt.t('damage.title')}</Card.Title>
      <Card.Description>{rt.t('damage.hint')}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      {#each charges as c (c.id)}
        <div class="flex flex-col gap-2">
          <div class="flex justify-between gap-4"><span>{c.description}</span><span class="tabular-nums">{rt.format.money(c.amount)}</span></div>
          {#if c.photo_ids.length && rt.url.damagePhoto}
            <div class="flex flex-wrap gap-2">
              {#each c.photo_ids as id, i (id)}
                <a href={rt.url.damagePhoto(id, orderToken)} target="_blank" rel="noopener" class="block size-20 overflow-hidden rounded-md border">
                  <img src={rt.url.damagePhoto(id, orderToken)} alt={rt.t('damage.photo', { n: i + 1 })} class="size-full object-cover" loading="lazy" />
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </Card.Content>
  </Card.Root>
{/if}
