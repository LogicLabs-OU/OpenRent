<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Badge } from '@openrent/ui/badge';
  import { Button } from '@openrent/ui/button';
  import XIcon from '@lucide/svelte/icons/x';
  import ProductPicker, { type PickedVariant } from '#lib/components/product-picker.svelte';
  import { api, t, toast, notifyError, fieldErrors, session } from '#lib';

  /**
   * What goes with a product (FR-CAT-7): accessories offered with it when booking, related products, and
   * those often rented with it, which OpenRent works out from bookings each week.
   */
  let { productId }: { productId: string } = $props();
  type Item = { id: string; name: string };
  let accessory = $state<Item[]>([]);
  let related = $state<Item[]>([]);
  let often = $state<(Item & { score: number })[]>([]);
  let errors = $state<Record<string, string>>({});

  async function load() {
    const r = await api.get(`/products/${productId}/relations`);
    accessory = r.accessory.map((x: any) => ({ id: x.id, name: x.name }));
    related = r.related.map((x: any) => ({ id: x.id, name: x.name }));
    often = r.often_rented_with;
  }
  $effect(() => {
    void productId;
    load().catch(notifyError);
  });

  async function save() {
    errors = {};
    try {
      await api.put(`/products/${productId}/relations`, { accessory: accessory.map((x) => x.id), related: related.map((x) => x.id) });
      toast.success(t('common.saved'));
      await load();
    } catch (e) {
      errors = fieldErrors(e);
      if (!Object.keys(errors).length) notifyError(e);
    }
  }
  /** The picker names a variant; relations are between products. */
  async function add(list: Item[], v: PickedVariant) {
    const variant = await api.get(`/variants/${v.id}`).catch(notifyError);
    if (!variant || variant.product_id === productId || list.some((x) => x.id === variant.product_id)) return;
    list.push({ id: variant.product_id, name: v.label });
  }
</script>

<Card.Root data-testid="product-relations">
  <Card.Header><Card.Title>{t('relations.title')}</Card.Title><Card.Description>{t('relations.description')}</Card.Description></Card.Header>
  <Card.Content class="flex flex-col gap-6">
    {#each [['accessory', accessory], ['related', related]] as [kind, list] (kind)}
      <Field.Set>
        <Field.Legend variant="label">{t(`relations.${kind}` as any)}</Field.Legend>
        <Field.Description>{t(`relations.${kind}_hint` as any)}</Field.Description>
        {#if (list as Item[]).length}
          <div class="flex flex-wrap gap-1.5">
            {#each list as Item[] as x, i (x.id)}
              <Badge variant="secondary" class="gap-1 pr-1">{x.name}<button type="button" class="hover:bg-muted rounded-sm" aria-label={t('relations.remove', { name: x.name })} onclick={() => (list as Item[]).splice(i, 1)}><XIcon class="size-3" /></button></Badge>
            {/each}
          </div>
        {/if}
        {#if errors[kind as string]}<Field.Error>{errors[kind as string]}</Field.Error>{/if}
        {#if session.can('catalog:write')}<ProductPicker onpick={(v) => add(list as Item[], v)} />{/if}
      </Field.Set>
    {/each}
    <Field.Set>
      <Field.Legend variant="label">{t('relations.often')}</Field.Legend>
      {#if often.length}
        <ul class="flex flex-col gap-1 text-sm">{#each often as x (x.id)}<li>{x.name} <span class="text-muted-foreground">· {t('relations.bookings', { count: x.score })}</span></li>{/each}</ul>
      {:else}
        <Field.Description>{t('relations.often_none')}</Field.Description>
      {/if}
    </Field.Set>
  </Card.Content>
  {#if session.can('catalog:write')}<Card.Footer><Button onclick={save}>{t('common.save')}</Button></Card.Footer>{/if}
</Card.Root>
