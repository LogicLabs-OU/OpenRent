<script lang="ts">
  import { page } from '$app/state';
  import { getRuntime, type Cart, type Location } from '@openrent/theme-sdk';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { checkoutExtra } from './extensions.svelte.ts';
  import { t } from './i18n/index.ts';

  /**
   * At checkout: where the gear changes hands. With a delivery chosen, the times on the pickup and return
   * days the location offers (and saved addresses to deliver to); otherwise the location to pick up from.
   */
  const rt = getRuntime();
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0], params: Record<string, string | number> = {}) => t(key, params, locale);
  const cart = $derived(page.data.cart as Cart | undefined);
  const loc = $derived((page.data.shop?.location ?? page.data.shop?.locations?.[0]) as Location | undefined);
  const delivering = $derived(!!cart?.quote?.optional_fees?.some((f) => f.kind === 'delivery' && f.selected));
  const saved = $derived((page.data.savedAddresses ?? []) as { id: string; label: string | null; address: Record<string, string> }[]);
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  // The weekday of an instant at the location.
  const weekday = (iso: string) => {
    const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: loc?.timezone }).format(new Date(iso)).toLowerCase().slice(0, 3);
    return DAYS.find((d) => d === name) ?? 'mon';
  };
  const slots = (iso: string | null | undefined) => (iso ? (loc?.delivery_windows?.[weekday(iso)] ?? []) : []);
  const offered = $derived(!!loc?.delivery_windows && Object.values(loc.delivery_windows).some((l) => l?.length));
  const line = (a: Record<string, string>) => [a.line1, [a.postal_code, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: loc?.timezone }).format(new Date(iso));

  async function deliverTo(id: string) {
    const a = saved.find((x) => x.id === id);
    if (a && rt.setOptions) await rt.setOptions({ address: line(a.address), postcode: a.address.postal_code ?? null });
  }
</script>

{#if cart && loc}
  {#if delivering && offered}
    <Field.Set data-testid="delivery-choice">
      <Field.Legend variant="label">{tr('delivery.title')}</Field.Legend>
      {#if saved.length}
        <Field.Field>
          <Field.Label for="or-deliver-to">{tr('delivery.saved_address')}</Field.Label>
          <NativeSelect id="or-deliver-to" class="w-full" onchange={(e) => deliverTo((e.currentTarget as HTMLSelectElement).value)}>
            <NativeSelectOption value="">{tr('delivery.typed_address')}</NativeSelectOption>
            {#each saved as a (a.id)}<NativeSelectOption value={a.id}>{a.label ? `${a.label} · ${line(a.address)}` : line(a.address)}</NativeSelectOption>{/each}
          </NativeSelect>
        </Field.Field>
      {/if}
      {#each [['delivery', cart.starts_at], ['collection', cart.ends_at]] as const as [kind, at] (kind)}
        {@const err = checkoutExtra.errors[`${kind}.window`]}
        <Field.Field data-invalid={!!err || undefined}>
          <Field.Label for="or-{kind}-window">{at ? tr(`delivery.${kind}_on`, { date: date(at) }) : tr(`delivery.${kind}`)}</Field.Label>
          <NativeSelect id="or-{kind}-window" class="w-full" value={String(checkoutExtra.values[`${kind}.window`] ?? '')} onchange={(e) => (checkoutExtra.values[`${kind}.window`] = (e.currentTarget as HTMLSelectElement).value)} aria-invalid={!!err}>
            <NativeSelectOption value="">{slots(at).length ? tr('delivery.choose_time') : tr('delivery.none_that_day')}</NativeSelectOption>
            {#each slots(at) as [a, b] (a)}<NativeSelectOption value={`${a}-${b}`}>{a}–{b}</NativeSelectOption>{/each}
          </NativeSelect>
          {#if err}<Field.Error>{err}</Field.Error>{/if}
        </Field.Field>
      {/each}
    </Field.Set>
  {:else if !delivering}
    <p class="text-sm" data-testid="pickup-at">{tr('delivery.pickup_at', { name: loc.name })}{line(loc.address ?? {}) ? ` · ${line(loc.address ?? {})}` : ''}</p>
  {/if}
{/if}
