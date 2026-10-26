<script lang="ts">
  import { getRuntime, weekStart, type CalendarDay } from '@openrent/theme-sdk';
  import { parseDate, type DateValue } from '@internationalized/date';
  import type { DateRange } from 'bits-ui';
  import * as RangeCalendar from '@openrent/ui/range-calendar';

  /** Month availability for one variant (FR-SF-4). `from`/`to` are local dates (YYYY-MM-DD). */
  let {
    variantId,
    from = $bindable(''),
    to = $bindable(''),
  }: { variantId: string; from?: string; to?: string } = $props();
  const rt = getRuntime();

  // svelte-ignore state_referenced_locally
  let range = $state<DateRange>({
    start: from ? parseDate(from) : undefined,
    end: to ? parseDate(to) : undefined,
  });
  // svelte-ignore state_referenced_locally
  let placeholder = $state<DateValue>(parseDate(from || new Date().toISOString().slice(0, 10)));
  let days = $state<Record<string, CalendarDay>>({});
  let loading = $state(false);

  $effect(() => {
    from = range.start?.toString() ?? '';
    to = range.end?.toString() ?? '';
  });
  $effect(() => {
    const month = `${placeholder.year}-${String(placeholder.month).padStart(2, '0')}`;
    const v = variantId;
    loading = true;
    rt.calendar(v, month).then(
      (d) => {
        days = { ...days, ...Object.fromEntries(d.map((x) => [x.date, x])) };
        loading = false;
      },
      () => (loading = false),
    );
  });

  // Fully booked, past and too-soon days cannot be picked; closed days only block pickup and return,
  // so a rental may span them (times are checked against opening hours).
  const blocked = (d: DateValue) => {
    const s = days[d.toString()]?.status;
    return s === 'unavailable' || s === 'past' || s === 'notice';
  };
  // Blackout reasons are free text set by the shop; known codes are translated.
  const reason = (info: CalendarDay | undefined) => {
    if (!info || info.status === 'available') return undefined;
    const code = info.reason ?? info.status;
    const msg = rt.t(`calendar.reason.${code}`);
    return msg === `calendar.reason.${code}` ? code : msg;
  };
</script>

<RangeCalendar.RangeCalendar
  bind:value={range}
  bind:placeholder
  locale={rt.shop.locale}
  weekStartsOn={weekStart(rt.shop.locale)}
  isDateUnavailable={blocked}
  aria-busy={loading}
  class="w-full rounded-lg border p-2 [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(11)]"
>
  {#snippet day({ day, outsideMonth })}
    {@const info = days[day.toString()]}
    <RangeCalendar.Day
      title={reason(info) ??
        (info?.available != null ? rt.t('calendar.free', { count: info.available }) : undefined)}
      class={info?.status === 'closed' ? 'text-muted-foreground' : undefined}
    >
      {day.day}
      <!-- Drawn from data-free, so the day's accessible name stays the date; the title gives the count. -->
      {#if !outsideMonth && info?.status === 'available' && info.available != null}<span
          class="tabular-nums after:content-[attr(data-free)]"
          data-free={info.available}
          aria-hidden="true"
        ></span>{/if}
    </RangeCalendar.Day>
  {/snippet}
</RangeCalendar.RangeCalendar>
