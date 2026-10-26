<script lang="ts">
  import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';
  import * as Calendar from '@openrent/ui/calendar';
  import { weekStart } from '@openrent/i18n';
  import { api, getLocale, t } from '#lib';

  let { variantId }: { variantId: string } = $props();
  let placeholder = $state<DateValue>(today(getLocalTimeZone()));
  let days = $state<Record<string, { available: number | null; status: string; reason?: string }>>({});

  $effect(() => {
    const month = `${placeholder.year}-${String(placeholder.month).padStart(2, '0')}`;
    const v = variantId;
    api.get(`/availability/calendar?variant_id=${v}&month=${month}`).then((r) => {
      days = Object.fromEntries(r.data.map((d: any) => [d.date, d]));
    });
  });
  const key = (d: DateValue) => d.toString();
</script>

<Calendar.Calendar
  type="single"
  bind:placeholder
  readonly
  locale={getLocale()}
  weekStartsOn={weekStart(getLocale())}
  class="w-full rounded-lg border [--cell-size:--spacing(12)]"
  isDateUnavailable={(d) => days[key(d)]?.status === 'unavailable' || days[key(d)]?.status === 'closed'}
>
  {#snippet day({ day, outsideMonth })}
    {@const info = days[key(day)]}
    <Calendar.Day title={info?.reason ? t(`calendar.reason.${info.reason}` as any) : undefined}>
      {day.day}
      {#if !outsideMonth && info}<span class="tabular-nums">{info.available ?? '∞'}</span>{/if}
    </Calendar.Day>
  {/snippet}
</Calendar.Calendar>
<p class="mt-2 text-xs text-muted-foreground">{t('product.calendar_hint')}</p>
