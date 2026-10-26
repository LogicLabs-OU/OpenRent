<script lang="ts">
  import { getRuntime, type OrderConfirmationData } from '@openrent/theme-sdk';
  import { box, boxHead } from '../lib/marquee.ts';

  /** Damage found after the return, with the shop's photos (theme API 1.4). */
  let {
    charges,
    orderToken,
  }: { charges: OrderConfirmationData['order']['damage_charges']; orderToken: string } = $props();
  const rt = getRuntime();
</script>

{#if charges?.length}
  <section class={box} data-testid="order-damage" aria-labelledby="or-damage">
    <h2 id="or-damage" class={boxHead}>{rt.t('damage.title')}</h2>
    <div class="flex flex-col gap-4 p-4 md:p-6">
      <p class="text-muted-foreground text-lg uppercase">{rt.t('damage.hint')}</p>
      {#each charges as c (c.id)}
        <div class="flex flex-col gap-2">
          <div class="flex justify-between gap-4">
            <span class="uppercase">{c.description}</span><span class="mq-mono text-sm">{rt.format.money(c.amount)}</span>
          </div>
          {#if c.photo_ids.length && rt.url.damagePhoto}
            <div class="flex flex-wrap gap-2">
              {#each c.photo_ids as id, i (id)}
                <a
                  href={rt.url.damagePhoto(id, orderToken)}
                  target="_blank"
                  rel="noopener"
                  class="block size-20 overflow-hidden border border-(--mq-ink)"
                >
                  <img
                    src={rt.url.damagePhoto(id, orderToken)}
                    alt={rt.t('damage.photo', { n: i + 1 })}
                    class="size-full object-cover"
                    loading="lazy"
                  />
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}
