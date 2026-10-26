<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import * as Field from '@openrent/ui/field';
  import * as RadioGroup from '@openrent/ui/radio-group';
  import { bundlePicks } from './extensions.svelte.ts';
  import { t } from './i18n/index.ts';

  /**
   * The slots of a choice bundle on its product page (FR-CAT-6), shown by the `product.before_add` slot in
   * every theme: one option per slot, the first one free by default. Adding to the cart sends the picks.
   */
  type Option = { variant_id: string; name: string; quantity: number; available: number | null };
  let { product }: { product: { variants: { id: string }[]; bundle: { slots: { name: string; options: Option[] }[] } } } = $props();
  const variantId = $derived(product.variants[0]?.id ?? '');
  const locale = $derived(page.data.shop?.locale);
  const id = (slot: string, v: string) => `or-pick-${slot.replace(/\W+/g, '-')}-${v}`;

  $effect(() => {
    if (!variantId) return;
    // Read without tracking: this effect writes the picks itself.
    const current = untrack(() => bundlePicks[variantId] ?? {});
    const next: Record<string, string> = {};
    for (const s of product.bundle.slots) {
      const kept = s.options.find((o) => o.variant_id === current[s.name] && o.available !== 0);
      next[s.name] = (kept ?? s.options.find((o) => o.available !== 0) ?? s.options[0]!).variant_id;
    }
    bundlePicks[variantId] = next;
  });
</script>

<div class="flex flex-col gap-4" data-testid="bundle-picker">
  {#each product.bundle.slots as s (s.name)}
    <Field.Set>
      <Field.Legend variant="label">{s.name}</Field.Legend>
      <RadioGroup.Root value={bundlePicks[variantId]?.[s.name] ?? ''} onValueChange={(v) => (bundlePicks[variantId] = { ...bundlePicks[variantId], [s.name]: v })}>
        {#each s.options as o (o.variant_id)}
          <Field.Field orientation="horizontal" data-disabled={o.available === 0 || undefined}>
            <RadioGroup.Item id={id(s.name, o.variant_id)} value={o.variant_id} disabled={o.available === 0} />
            <Field.Label for={id(s.name, o.variant_id)} class="font-normal">
              {o.quantity > 1 ? `${o.quantity} × ` : ''}{o.name}{#if o.available === 0}<span class="opacity-70"> · {t('bundle.not_available', {}, locale)}</span>{/if}
            </Field.Label>
          </Field.Field>
        {/each}
      </RadioGroup.Root>
    </Field.Set>
  {/each}
</div>
