<script lang="ts">
  import { getRuntime, weekStart, formatTime } from '@openrent/theme-sdk';
  import { parseDate, today } from '@internationalized/date';
  import type { DateRange } from 'bits-ui';
  import * as Popover from '@openrent/ui/popover';
  import * as RangeCalendar from '@openrent/ui/range-calendar';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Button, buttonVariants } from '@openrent/ui/button';
  import { Label } from '@openrent/ui/label';
  import { cn } from '@openrent/ui/utils';
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import XIcon from '@lucide/svelte/icons/x';
  import { toast } from 'svelte-sonner';
  import { formatLocalDate } from '../lib/dates.ts';
  import { lift, select, wrap } from '../lib/retro.ts';

  /** `band` sits under the header on inner pages; `panel` is the home page hero's search row. */
  let { variant = 'band' }: { variant?: 'band' | 'panel' } = $props();
  const panel = $derived(variant === 'panel');

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
</script>

<div class={panel ? 'w-full' : 'border-b border-black bg-white'} data-testid="date-bar">
  <form
    class={[
      panel
        ? 'grid grid-cols-2 items-end gap-3 text-left md:flex md:justify-center'
        : [wrap, 'grid grid-cols-2 items-end gap-3 py-3 md:flex md:flex-wrap'],
    ]}
    onsubmit={apply}
    aria-label={rt.t('dates.hint')}
  >
    <div class="col-span-2 flex flex-col gap-1.5">
      <Label for="or-dates" class="font-normal">{rt.t('dates.pickup')} – {rt.t('dates.return')}</Label>
      <Popover.Root bind:open>
        <Popover.Trigger
          id="or-dates"
          class={cn(
            buttonVariants({ variant: 'outline' }),
            'w-full justify-start rounded-[0.25rem] border-black bg-white font-normal hover:bg-white',
            panel ? 'h-14 text-lg md:w-72' : 'h-11 text-base md:w-64',
            !fromDate && 'text-muted-foreground',
          )}
        >
          <CalendarDaysIcon />{label}
        </Popover.Trigger>
        <Popover.Content
          class="w-auto rounded-[0.25rem] p-0 shadow-[4px_4px_0_0_#000] ring-1 ring-black"
          align="start"
        >
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
                {#if closed}<span class="bg-muted-foreground/60 size-1 rounded-full" aria-hidden="true"
                  ></span>{/if}
              </RangeCalendar.Day>
            {/snippet}
          </RangeCalendar.RangeCalendar>
        </Popover.Content>
      </Popover.Root>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label for="or-from-time" class="font-normal">{rt.t('dates.pickup_time')}</Label>
      <NativeSelect
        id="or-from-time"
        class={[
          'w-full',
          select,
          panel
            ? 'md:w-32 [&_select]:h-14 [&_select]:text-lg'
            : 'md:w-28 [&_select]:h-11 [&_select]:text-base',
        ]}
        bind:value={fromTime}
        disabled={!fromOpts.length}
      >
        {#each fromOpts as time (time)}<NativeSelectOption value={time}>{formatTime(time, shop.locale)}</NativeSelectOption
          >{:else}<NativeSelectOption value=""
            >{fromDate ? rt.t('dates.closed_short') : '--:--'}</NativeSelectOption
          >{/each}
      </NativeSelect>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label for="or-to-time" class="font-normal">{rt.t('dates.return_time')}</Label>
      <NativeSelect
        id="or-to-time"
        class={[
          'w-full',
          select,
          panel
            ? 'md:w-32 [&_select]:h-14 [&_select]:text-lg'
            : 'md:w-28 [&_select]:h-11 [&_select]:text-base',
        ]}
        bind:value={toTime}
        disabled={!toOpts.length}
      >
        {#each toOpts as time (time)}<NativeSelectOption value={time}>{formatTime(time, shop.locale)}</NativeSelectOption
          >{:else}<NativeSelectOption value=""
            >{toDate ? rt.t('dates.closed_short') : '--:--'}</NativeSelectOption
          >{/each}
      </NativeSelect>
    </div>
    <div class="col-span-2 flex gap-2">
      <Button
        type="submit"
        class={[
          'flex-1 rounded-none bg-black font-normal text-white hover:bg-black md:flex-none',
          panel ? 'h-14 px-8 text-lg' : 'h-11 px-5 text-base',
          lift,
        ]}
        disabled={busy}>{rt.t('dates.apply')}</Button
      >
      {#if shop.dates.from}<Button
          type="button"
          variant="ghost"
          class={['rounded-none font-normal', panel ? 'h-14 text-lg' : 'h-11 text-base']}
          onclick={clear}><XIcon />{rt.t('dates.clear')}</Button
        >{/if}
    </div>
    {#if error}<p class="text-destructive col-span-2 w-full text-sm" role="alert">{error}</p>{/if}
  </form>
</div>
