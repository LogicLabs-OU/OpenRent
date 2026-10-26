<script lang="ts">
  import * as NativeSelect from '@openrent/ui/native-select';
  import MapPinIcon from '@lucide/svelte/icons/map-pin';
  import { session, t } from '#lib';

  /** The header's location picker: lists, the dashboard and reports follow it. Hidden for single-location shops. */
</script>

{#if !session.singleLocation}
  <div class="flex items-center gap-1.5">
    <MapPinIcon class="size-4 text-muted-foreground" aria-hidden="true" />
    <NativeSelect.Root
      size="sm"
      class="w-36 sm:w-44"
      aria-label={t('locations.switcher')}
      data-testid="location-switcher"
      value={session.locationId}
      onchange={(e) => session.setLocation((e.currentTarget as HTMLSelectElement).value)}
    >
      <NativeSelect.Option value="">{t('calendar.all_locations')}</NativeSelect.Option>
      {#each session.locations as l (l.id)}<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>{/each}
    </NativeSelect.Root>
  </div>
{/if}
