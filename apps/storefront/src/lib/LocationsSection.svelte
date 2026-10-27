<script lang="ts">
  import { page } from '$app/state';
  import type { Location, SectionInstance } from '@openrent/theme-sdk';
  import { t } from './i18n/index.ts';

  /** The built-in locations section: each location's address, contact details, opening hours and closed days. */
  let { section }: { section: SectionInstance } = $props();
  const locale = $derived(page.data.shop?.locale ?? 'en');
  const locations = $derived((page.data.shop?.locations ?? []) as Location[]);
  const heading = $derived(String(section.settings.heading ?? ''));
  const showClosures = $derived(section.settings.show_closures !== false);
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  // 2024-01-01 was a Monday.
  const dayName = (i: number) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
  const lines = (l: Location) => [l.address?.line1, l.address?.line2, [l.address?.postal_code, l.address?.city].filter(Boolean).join(' '), l.address?.country].filter(Boolean) as string[];
  const map = (l: Location) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(lines(l).join(', '))}`;
  const range = (c: { starts_at: string; ends_at: string }, tz: string) => {
    const f = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: tz });
    // A closure ends at midnight after its last day.
    const last = new Date(new Date(c.ends_at).getTime() - 1);
    const a = f.format(new Date(c.starts_at));
    const b = f.format(last);
    return a === b ? a : `${a} – ${b}`;
  };
</script>

<section class="py-8" aria-labelledby="or-locations-{section.id}" data-testid="locations-section">
  {#if heading}<h2 id="or-locations-{section.id}" class="mb-6 text-2xl font-semibold tracking-tight">{heading}</h2>{/if}
  <div class="grid gap-6 md:grid-cols-2">
    {#each locations as l (l.id)}
      <article class="flex flex-col gap-3 rounded-xl border p-5">
        <h3 class="text-lg font-semibold">{l.name}</h3>
        {#if lines(l).length}
          <address class="not-italic">{#each lines(l) as line, i (i)}<span class="block">{line}</span>{/each}</address>
          <a class="w-fit underline underline-offset-4" href={map(l)} rel="noopener" target="_blank">{t('locations.map', {}, locale)}</a>
        {/if}
        {#if l.phone || l.email}
          <p class="flex flex-col">
            {#if l.phone}<a class="w-fit underline-offset-4 hover:underline" href="tel:{l.phone.replace(/\s+/g, '')}">{l.phone}</a>{/if}
            {#if l.email}<a class="w-fit underline-offset-4 hover:underline" href="mailto:{l.email}">{l.email}</a>{/if}
          </p>
        {/if}
        {#if Object.keys(l.opening_hours ?? {}).length}
          <table class="text-sm">
            <caption class="sr-only">{t('locations.hours', { name: l.name }, locale)}</caption>
            <tbody>
              {#each DAYS as d, i (d)}
                <tr>
                  <th scope="row" class="py-0.5 pr-4 text-left font-normal opacity-80">{dayName(i)}</th>
                  <td class="py-0.5 tabular-nums">{(l.opening_hours[d] ?? []).length ? l.opening_hours[d]!.map(([a, b]) => `${a}–${b}`).join(', ') : t('locations.closed', {}, locale)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        {#if showClosures && l.closures?.length}
          <div>
            <h4 class="text-sm font-medium">{t('locations.closed_on', {}, locale)}</h4>
            <ul class="text-sm opacity-80">
              {#each l.closures as c (c.starts_at)}<li>{range(c, l.timezone)}{c.reason ? ` · ${c.reason}` : ''}</li>{/each}
            </ul>
          </div>
        {/if}
      </article>
    {/each}
  </div>
</section>
