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
  import { big } from '../lib/nightfall.ts';

  /** `bar` is a glass strip under the nav on inner pages; `panel` is the glass form under the home hero. */
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

<div
  class={[
    'nf-glass shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl',
    variant === 'panel' ? 'rounded-[28px] p-5 md:p-6' : 'rounded-3xl px-4 py-3 md:px-5 lg:rounded-full lg:py-2.5 lg:pl-6',
  ]}
  data-testid="date-bar"
>
  {#if variant === 'panel'}<p class="mb-4 flex items-center gap-2 text-[0.8125rem] font-semibold text-white/80">
      <CalendarDaysIcon class="size-4 text-[color:var(--nf-accent-text)]" aria-hidden="true" />{rt.t('dates.hint')}
    </p>{/if}
  <form
    class={['grid grid-cols-2 items-end gap-3 md:flex md:flex-wrap', variant === 'bar' && 'lg:flex-nowrap lg:items-center']}
    onsubmit={apply}
    aria-label={rt.t('dates.hint')}
  >
    {#if variant === 'bar'}<p class="hidden shrink-0 self-end pb-3 text-[0.8125rem] font-semibold text-white/70 xl:block">
        {rt.t('dates.hint_short')}
      </p>{/if}
    <div class={['col-span-2 flex flex-col gap-1.5', variant === 'panel' ? 'md:min-w-72 md:flex-1' : 'lg:flex-1']}>
      <Label for="or-dates" class="text-xs text-white/60">{rt.t('dates.pickup')} – {rt.t('dates.return')}</Label>
      <Popover.Root bind:open>
        <Popover.Trigger
          id="or-dates"
          class={cn(
            buttonVariants({ variant: 'outline' }),
            'h-11 w-full justify-start rounded-[14px] border-white/15 bg-white/5 font-normal text-white hover:bg-white/10 dark:border-white/15 dark:bg-white/5',
          )}
        >
          <CalendarDaysIcon class="text-white/60" />{label}
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
                {#if closed}<span class="bg-muted-foreground/60 size-1 rounded-full" aria-hidden="true"
                  ></span>{/if}
              </RangeCalendar.Day>
            {/snippet}
          </RangeCalendar.RangeCalendar>
        </Popover.Content>
      </Popover.Root>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label for="or-from-time" class="text-xs text-white/60">{rt.t('dates.pickup_time')}</Label>
      <NativeSelect
        id="or-from-time"
        class="w-full md:w-32"
        bind:value={fromTime}
        disabled={!fromOpts.length}
      >
        {#each fromOpts as time (time)}<NativeSelectOption value={time}
            >{formatTime(time, shop.locale)}</NativeSelectOption
          >{:else}<NativeSelectOption value=""
            >{fromDate ? rt.t('dates.closed_short') : '--:--'}</NativeSelectOption
          >{/each}
      </NativeSelect>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label for="or-to-time" class="text-xs text-white/60">{rt.t('dates.return_time')}</Label>
      <NativeSelect
        id="or-to-time"
        class="w-full md:w-32"
        bind:value={toTime}
        disabled={!toOpts.length}
      >
        {#each toOpts as time (time)}<NativeSelectOption value={time}
            >{formatTime(time, shop.locale)}</NativeSelectOption
          >{:else}<NativeSelectOption value=""
            >{toDate ? rt.t('dates.closed_short') : '--:--'}</NativeSelectOption
          >{/each}
      </NativeSelect>
    </div>
    <div class={['col-span-2 flex gap-2', variant === 'bar' && 'lg:self-end']}>
      <Button type="submit" class={cn(big, 'h-11 flex-1 md:flex-none')} disabled={busy}
        >{rt.t('dates.apply')}</Button
      >
      {#if shop.dates.from}<Button
          type="button"
          variant="ghost"
          class="h-11 rounded-full text-white/80 hover:bg-white/10 dark:hover:bg-white/10"
          onclick={clear}><XIcon />{rt.t('dates.clear')}</Button
        >{/if}
    </div>
    {#if error}<p class="w-full text-sm text-rose-300" role="alert">{error}</p>{/if}
  </form>
</div>
