<script lang="ts">
  import { page } from '$app/state';
  import { getRuntime, type Location } from '@openrent/theme-sdk';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { t } from './i18n/index.ts';

  /** Where the visitor rents from, when the shop has several locations: stock, opening hours and the cart follow it. */
  const rt = getRuntime();
  const locale = $derived(page.data.shop?.locale);
  const locations = $derived((page.data.shop?.locations ?? []) as Location[]);
  const current = $derived((page.data.shop?.location as Location | undefined)?.id ?? locations[0]?.id ?? '');
  let busy = $state(false);

  async function pick(id: string) {
    if (!rt.setLocation || id === current) return;
    busy = true;
    try {
      await rt.setLocation(id);
    } finally {
      busy = false;
    }
  }
</script>

{#if locations.length > 1}
  <div class="flex items-center gap-2 text-sm" data-testid="location-picker">
    <label for="or-location" class="opacity-80">{t('location.pick_up_at', {}, locale)}</label>
    <NativeSelect id="or-location" size="sm" value={current} disabled={busy} onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)}>
      {#each locations as l (l.id)}<NativeSelectOption value={l.id}>{l.name}</NativeSelectOption>{/each}
    </NativeSelect>
  </div>
{/if}
