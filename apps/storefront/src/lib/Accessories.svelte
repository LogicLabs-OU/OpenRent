<script lang="ts">
  import { page } from '$app/state';
  import * as Field from '@openrent/ui/field';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { getRuntime } from '@openrent/theme-sdk';
  import { accessoryChoices } from './extensions.svelte.ts';
  import { t } from './i18n/index.ts';

  /**
   * Accessories offered with a product (FR-CAT-7), ticked before adding it to the cart, and products
   * that go with it as links. Shown by the `product.before_add` slot in every theme.
   */
  type Card = { id: string; name: string; slug: string; variant_id: string | null; price: { description: string } | null };
  let { product }: { product: { variants: { id: string }[]; accessories?: Card[]; related?: Card[] } } = $props();
  const rt = getRuntime();
  const locale = $derived(page.data.shop?.locale);
  const variantId = $derived(product.variants[0]?.id ?? '');
  const chosen = (id: string) => (accessoryChoices[variantId] ?? []).includes(id);
  function toggle(id: string, on: boolean) {
    const now = (accessoryChoices[variantId] ?? []).filter((x) => x !== id);
    accessoryChoices[variantId] = on ? [...now, id] : now;
  }
</script>

{#if product.accessories?.length}
  <Field.Set data-testid="accessories">
    <Field.Legend variant="label">{t('accessories.title', {}, locale)}</Field.Legend>
    {#each product.accessories.filter((a) => a.variant_id) as a (a.id)}
      <Field.Field orientation="horizontal">
        <Checkbox id={`or-acc-${a.id}`} checked={chosen(a.variant_id!)} onCheckedChange={(v) => toggle(a.variant_id!, v === true)} />
        <Field.Label for={`or-acc-${a.id}`} class="font-normal">{a.name}{#if a.price}<span class="opacity-70"> · {a.price.description}</span>{/if}</Field.Label>
      </Field.Field>
    {/each}
  </Field.Set>
{/if}
{#if product.related?.length}
  <nav class="flex flex-col gap-1 text-sm" aria-label={t('accessories.related', {}, locale)} data-testid="related-products">
    <span class="font-medium">{t('accessories.related', {}, locale)}</span>
    <ul class="flex flex-wrap gap-x-3 gap-y-1">{#each product.related as r (r.id)}<li><a class="underline underline-offset-4" href={rt.url.product(r.slug)}>{r.name}</a></li>{/each}</ul>
  </nav>
{/if}
