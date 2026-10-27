<script lang="ts">
  import { page } from '$app/state';
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import CalendarPlusIcon from '@lucide/svelte/icons/calendar-plus';
  import { t } from './i18n/index.ts';

  /** Calendar links for a booking: a file for any calendar, and Google Calendar for the pickup. */
  let { order }: { order: { token: string; number: number; starts_at: string; ends_at: string; status: string } } = $props();
  const rt = getRuntime();
  const locale = $derived(page.data.shop?.locale);
  const shop = $derived(page.data.shop?.tenant?.name ?? '');
  const loc = $derived(page.data.shop?.location ?? page.data.shop?.locations?.[0]);
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = $derived(`${rt.url.order(order.token)}/calendar.ics`);
  const google = $derived.by(() => {
    const end = new Date(new Date(order.starts_at).getTime() + 30 * 60_000).toISOString();
    const p = new URLSearchParams({ action: 'TEMPLATE', text: t('order.calendar_pickup', { number: order.number, shop }, locale), dates: `${stamp(order.starts_at)}/${stamp(end)}`, ...(loc ? { location: [loc.name, loc.address?.line1, loc.address?.city].filter(Boolean).join(', ') } : {}) });
    return `https://calendar.google.com/calendar/render?${p}`;
  });
</script>

{#if !['cancelled', 'expired'].includes(order.status)}
  <div class="flex flex-wrap justify-center gap-2" data-testid="order-calendar">
    <Button size="sm" variant="outline" href={ics} download><CalendarPlusIcon />{t('order.calendar_add', {}, locale)}</Button>
    <Button size="sm" variant="ghost" href={google} target="_blank" rel="noopener">{t('order.calendar_google', {}, locale)}</Button>
  </div>
{/if}
