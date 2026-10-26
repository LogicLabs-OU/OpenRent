<script module lang="ts">
  export interface BundleComponent {
    variant_id: string;
    label: string;
    quantity: number;
    slot_name: string;
  }
</script>

<script lang="ts">
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import ProductPicker, { type PickedVariant } from '#lib/components/product-picker.svelte';
  import { t } from '#lib';

  /**
   * The components of a bundle (FR-CAT-6). Components found by searching; those given the same choice
   * group (slot) are alternatives, and a booking picks one of them; the rest always come along.
   */
  let { components = $bindable([]), errors = {} }: { components?: BundleComponent[]; errors?: Record<string, string> } = $props();

  function add(v: PickedVariant) {
    if (v.type === 'bundle') return;
    const same = components.find((c) => c.variant_id === v.id && !c.slot_name);
    if (same) same.quantity++;
    else components.push({ variant_id: v.id, label: v.label, quantity: 1, slot_name: '' });
  }
  const slots = $derived([...new Set(components.map((c) => c.slot_name.trim()).filter(Boolean))]);
</script>

<div class="flex flex-col gap-3" data-testid="bundle-components">
  {#if components.length}
    <ul class="flex flex-col gap-2">
      {#each components as c, i (i)}
        <li class="grid grid-cols-[1fr_5rem_10rem_auto] items-center gap-2">
          <span class="truncate text-sm">{c.label}</span>
          <Input type="number" min="1" bind:value={c.quantity} aria-label={t('bundle.quantity_of', { name: c.label })} />
          <Input bind:value={c.slot_name} list="bundle-slots" placeholder={t('bundle.slot_placeholder')} aria-label={t('bundle.slot_of', { name: c.label })} />
          <Button type="button" variant="ghost" size="icon" aria-label={t('common.remove')} onclick={() => components.splice(i, 1)}><TrashIcon /></Button>
        </li>
      {/each}
    </ul>
    <datalist id="bundle-slots">{#each slots as s (s)}<option value={s}></option>{/each}</datalist>
  {/if}
  {#if errors.components}<Field.Error>{errors.components}</Field.Error>{/if}
  <ProductPicker onpick={add} />
  <Field.Description>{t('bundle.slots_hint')}</Field.Description>
</div>
