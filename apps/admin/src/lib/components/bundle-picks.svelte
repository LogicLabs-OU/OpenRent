<script lang="ts">
  import * as NativeSelect from '@openrent/ui/native-select';
  import { api, t, notifyError } from '#lib';

  /**
   * The options picked in a choice bundle's slots on an order line (FR-CAT-6); another option can be
   * picked while the order is a draft or quote, which makes the bundle's components again.
   */
  let { line, orderId, editable, onchange }: { line: any; orderId: string; editable: boolean; onchange: () => void } = $props();
  let slots = $state<{ name: string; options: { variant_id: string; name: string }[] }[]>([]);

  $effect(() => {
    if (!line.price_snapshot?.picks || !line.product_id) return;
    api
      .get(`/bundles/${line.product_id}`)
      .then((b) => {
        const out: typeof slots = [];
        for (const c of b.bundle?.components ?? []) {
          if (!c.slot_name) continue;
          let s = out.find((x) => x.name === c.slot_name);
          if (!s) out.push((s = { name: c.slot_name, options: [] }));
          s.options.push({ variant_id: c.variant_id, name: c.name });
        }
        slots = out;
      })
      .catch(notifyError);
  });

  async function pick(slot: string, variantId: string) {
    try {
      await api.patch(`/orders/${orderId}/lines/${line.id}`, { picks: { [slot]: variantId } });
      onchange();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

{#if slots.length}
  <div class="mt-2 flex flex-wrap gap-2" data-testid="bundle-picks">
    {#each slots as s (s.name)}
      <NativeSelect.Root size="sm" value={line.price_snapshot.picks[s.name]} disabled={!editable} aria-label={s.name} onchange={(e) => pick(s.name, (e.target as HTMLSelectElement).value)}>
        {#each s.options as o (o.variant_id)}<NativeSelect.Option value={o.variant_id}>{s.name}: {o.name}</NativeSelect.Option>{/each}
      </NativeSelect.Root>
    {/each}
  </div>
{/if}
