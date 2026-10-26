<script lang="ts">
  import { getRuntime, weekStart, formatTime } from '@openrent/theme-sdk';
  import { parseDate, today } from '@internationalized/date';
  import type { DateRange } from 'bits-ui';
  import * as Popover from '@openrent/ui/popover';
  import * as RangeCalendar from '@openrent/ui/range-calendar';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Label } from '@openrent/ui/label';
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import XIcon from '@lucide/svelte/icons/x';
  import { toast } from 'svelte-sonner';
  import { formatLocalDate } from '../lib/dates.ts';

  /**
   * Box-office date picker: joined cells for the dates, both times and a blue submit cell. `bar` sits under the
   * header on inner pages with the chosen month set huge on the right ("NOV ’26"); `panel` is the hero form.
   */
  let { variant = 'bar' }: { variant?: 'bar' | 'panel' } = $props();

  const rt = getRuntime();
  const shop = rt.shop;
  const tz = shop.locations[0]?.timezone ?? shop.tenant.timezone;
  const initial = (iso: string | null) => (iso ? parseDate(rt.zone.localDate(iso)) : undefined);

  let range = $state<DateRange>({ start: initial(shop.dates.from), end: initial(shop.dates.to) });
  let open = $state(false);
  let fromTime = $state(shop.dates.from ? rt.zone.localTime(shop.dates.from) : '');
  let toTime = $state(shop.dates.to ? rt.zone.localTime(shop.dates.to) : '');
  let error = $state('');
  let busy = $state(false);

  const fromDate = $derived(range.start?.toString() ?? '');
  const toDate = $derived(range.end?.toString() ?? '');
  const fromOpts = $derived(fromDate ? rt.zone.timeOptions(fromDate) : []);
  const toOpts = $derived(toDate ? rt.zone.timeOptions(toDate) : []);
  $effect(() => {
    if (fromOpts.length && !fromOpts.includes(fromTime)) fromTime = fromOpts[0]!;
    if (toOpts.length && !toOpts.includes(toTime)) toTime = toOpts[toOpts.length - 1]!;
  });
  const label = $derived(
    fromDate && toDate
      ? rt.t('dates.range', {
          from: formatLocalDate(fromDate, shop.locale),
          to: formatLocalDate(toDate, shop.locale),
        })
      : rt.t('dates.choose'),
  );
  /** The pickup month (or this month before any dates are chosen) as "NOV ’26". */
  const month = $derived.by(() => {
    const d = (range.start ?? today(tz)).toString();
    const name = formatLocalDate(d, shop.locale, { month: 'short' }).replace(/\.$/, '');
    return `${name} ’${d.slice(2, 4)}`;
  });

  async function apply(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (!fromDate || !toDate) {
      open = true;
      return;
    }
    if (!fromOpts.length || !toOpts.length) {
      error = rt.t('dates.closed');
      return;
    }
    const from = rt.zone.toInstant(fromDate, fromTime);
    const to = rt.zone.toInstant(toDate, toTime);
    if (new Date(to) <= new Date(from)) {
      error = rt.t('dates.order');
      return;
    }
    busy = true;
    try {
      await rt.setDates(from, to);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function clear() {
    range = { start: undefined, end: undefined };
    await rt.setDates(null, null).catch((err: Error) => toast.error(err.message));
  }

  const cell = 'flex min-w-0 flex-col justify-center gap-1 px-3 py-2 md:px-4';
  const select =
    'w-full [&_select]:h-8 [&_select]:border-0 [&_select]:bg-transparent [&_select]:px-0 [&_select]:text-lg [&_select]:font-semibold [&_select]:uppercase [&_select]:shadow-none';
</script>

<div
  class={[
    'flex flex-col gap-4',
    variant === 'bar' && 'lg:flex-row lg:items-end lg:justify-between lg:gap-10',
  ]}
  data-testid="date-bar"
>
  <form class="flex min-w-0 flex-col gap-2" onsubmit={apply} aria-label={rt.t('dates.hint')}>
    {#if variant === 'panel'}<p class="text-[0.8125rem] font-semibold tracking-[0.04em] uppercase">
        {rt.t('dates.hint')}
      </p>{/if}
    <div
      class={[
        'mq-cells grid grid-cols-2 bg-(--mq-paper)',
        variant === 'panel'
          ? 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
          : 'md:grid-cols-[minmax(15rem,auto)_9rem_9rem_auto]',
      ]}
    >
      <div class={[cell, 'col-span-2 md:col-span-1']}>
        <Label for="or-dates">{rt.t('dates.pickup')} – {rt.t('dates.return')}</Label>
        <Popover.Root bind:open>
          <Popover.Trigger
            id="or-dates"
            class="flex h-8 w-full items-center gap-2 text-left text-lg font-semibold uppercase hover:text-(--mq-accent)"
          >
            <CalendarDaysIcon class="size-4 shrink-0" aria-hidden="true" /><span class="truncate">{label}</span>
          </Popover.Trigger>
          <Popover.Content class="w-auto p-0" align="start">
            <RangeCalendar.RangeCalendar
              bind:value={range}
              locale={shop.locale}
              minValue={today(tz)}
              weekStartsOn={weekStart(shop.locale)}
              onValueChange={(v) => {
                if (v.start && v.end) open = false;
              }}
            >
              {#snippet day({ day, outsideMonth })}
                {@const closed = !outsideMonth && rt.zone.timeOptions(day.toString()).length === 0}
                <RangeCalendar.Day title={closed ? rt.t('dates.closed_short') : undefined}>
                  {day.day}
                  {#if closed}<span class="bg-muted-foreground/60 size-1" aria-hidden="true"></span>{/if}
                </RangeCalendar.Day>
              {/snippet}
            </RangeCalendar.RangeCalendar>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div class={cell}>
        <Label for="or-from-time">{rt.t('dates.pickup_time')}</Label>
        <NativeSelect id="or-from-time" class={select} bind:value={fromTime} disabled={!fromOpts.length}>
          {#each fromOpts as time (time)}<NativeSelectOption value={time}
              >{formatTime(time, shop.locale)}</NativeSelectOption
            >{:else}<NativeSelectOption value=""
              >{fromDate ? rt.t('dates.closed_short') : '--:--'}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </div>
      <div class={cell}>
        <Label for="or-to-time">{rt.t('dates.return_time')}</Label>
        <NativeSelect id="or-to-time" class={select} bind:value={toTime} disabled={!toOpts.length}>
          {#each toOpts as time (time)}<NativeSelectOption value={time}
              >{formatTime(time, shop.locale)}</NativeSelectOption
            >{:else}<NativeSelectOption value=""
              >{toDate ? rt.t('dates.closed_short') : '--:--'}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </div>
      <div class="col-span-2 flex md:col-span-1">
        <button
          type="submit"
          class="mq-cta flex min-h-14 flex-1 items-center justify-between gap-4 px-5 text-xl font-bold tracking-[-0.01em] uppercase disabled:opacity-60"
          disabled={busy}>{rt.t('dates.apply')}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></button
        >
        {#if shop.dates.from}<button
            type="button"
            class="grid w-14 shrink-0 place-items-center border-l border-(--mq-ink) hover:bg-(--mq-ink) hover:text-(--mq-paper)"
            onclick={clear}
            aria-label={rt.t('dates.clear')}
            title={rt.t('dates.clear')}><XIcon class="size-5" aria-hidden="true" /></button
          >{/if}
      </div>
    </div>
    {#if error}<p class="text-destructive text-base font-semibold uppercase" role="alert">{error}</p>{/if}
  </form>
  {#if variant === 'bar'}
    <button
      type="button"
      class="group flex items-center gap-3 self-start text-left lg:self-auto"
      aria-label={`${month}: ${rt.t('dates.change')}, ${label}`}
      onclick={() => (open = !open)}
    >
      <span
        class={[
          'mq-tight text-[clamp(3rem,7vw,6rem)] leading-[0.8] font-bold whitespace-nowrap uppercase',
          !range.start && 'mq-outline',
        ]}>{month}</span
      >
      <ChevronDownIcon
        class="size-8 shrink-0 transition-transform duration-400 group-hover:translate-y-1"
        strokeWidth={2.5}
        aria-hidden="true"
      />
    </button>
  {/if}
</div>
