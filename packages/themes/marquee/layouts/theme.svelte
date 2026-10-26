<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getRuntime, formatTime } from '@openrent/theme-sdk';
  import * as Sheet from '@openrent/ui/sheet';
  import { cn } from '@openrent/ui/utils';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
  import '../assets/marquee.css';
  import DateBar from '../snippets/DateBar.svelte';
  import LanguageMenu from '../snippets/LanguageMenu.svelte';
  import { marqueeCss, pad, wrap } from '../lib/marquee.ts';
  import { scrolled } from '../lib/motion.ts';

  /**
   * A blue notice strip, a sticky header with the wordmark in the middle and MENU on the right, the page,
   * and a dark footer: a big search line and a grid of ruled boxes with the counter, hours and links.
   */
  let { children, path }: { children: Snippet; path: string } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const css = $derived(marqueeCss(shop.settings));
  const loc = $derived(shop.locations[0]);
  const notice = $derived(
    shop.settings.show_notice === false
      ? ''
      : String(shop.settings.announcement ?? '').trim() || rt.t('notice.default'),
  );
  // The home page carries the date search in its hero; checkout and orders do not need it.
  // `path` includes the language prefix (/de/...), so compare with the runtime's URLs.
  const showDates = $derived(
    path !== rt.url.home() && !path.startsWith(rt.url.order('')) && !path.startsWith(rt.url.checkout()),
  );
  const account = $derived(
    shop.customer ? rt.url.account?.() : (rt.url.accountLogin?.() ?? rt.url.account?.()),
  );
  const accountLabel = $derived(shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in'));
  const searchUrl = $derived(rt.url.search?.());
  let menu = $state(false);
  const links = $derived([
    { href: rt.url.home(), label: rt.t('nav.home') },
    ...shop.categories.map((c) => ({ href: rt.url.category(c.slug), label: c.name })),
  ]);

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  /** Opening hours as rows of a short weekday and its time ranges (2024-01-01 was a Monday). */
  const hours = $derived(
    loc && Object.keys(loc.opening_hours ?? {}).length
      ? DAYS.map((d, i) => ({
          day: new Intl.DateTimeFormat(shop.locale, { weekday: 'short', timeZone: 'UTC' }).format(
            new Date(Date.UTC(2024, 0, 1 + i)),
          ),
          time: (loc.opening_hours[d] ?? [])
            .map(([a, b]) => `${formatTime(a, shop.locale)}–${formatTime(b, shop.locale)}`)
            .join(', '),
        }))
      : [],
  );
  const address = $derived(
    loc ? [loc.address?.line1, [loc.address?.postal_code, loc.address?.city].filter(Boolean).join(' ')].filter(Boolean) : [],
  );
  const footerLinks = $derived([
    ...shop.categories.slice(0, 6).map((c) => ({ href: rt.url.category(c.slug), label: c.name })),
    { href: rt.url.page('terms'), label: rt.t('footer.terms') },
    ...(account ? [{ href: account, label: accountLabel }] : []),
    { href: rt.url.cart(), label: rt.t('nav.cart') },
  ]);
</script>

<svelte:head>
  {@html `<style>${css}</style>`}
</svelte:head>

<div
  class="mq bg-background text-foreground flex min-h-svh flex-col [--mq-head:4rem] md:[--mq-head:5rem]"
  data-motion={shop.settings.reveal === false ? 'off' : undefined}
>
  <a
    class="sr-only z-50 bg-(--mq-accent) px-3 py-2 text-(--mq-on-accent) focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    href="#main">{rt.t('a11y.skip')}</a
  >
  {#if notice}<p
      class="bg-(--mq-accent) px-4 py-2 text-center text-[0.8125rem] leading-tight font-semibold tracking-[0.02em] text-(--mq-on-accent) uppercase"
    >
      {notice}
    </p>{/if}

  <header class="mq-head sticky top-0 z-30 bg-(--mq-paper)" use:scrolled>
    <div class={cn(wrap, 'grid h-(--mq-head) grid-cols-[1fr_auto_1fr] items-center gap-3')}>
      <div class="flex items-center gap-1 md:gap-3">
        {#if searchUrl}<a
            class="mq-chip h-10 hover:bg-(--mq-ink)"
            href={searchUrl}
            aria-label={rt.t('search.label')}
            ><span class="hidden lg:flex">{rt.t('nav.search')}</span><span class="w-10 justify-center px-0!"
              ><SearchIcon class="size-4" aria-hidden="true" /></span
            ></a
          >{/if}
        <div class="hidden md:block"><LanguageMenu /></div>
      </div>
      <a class="flex min-w-0 justify-center" href={rt.url.home()}>
        {#if shop.tenant.branding.logo_url}<img
            class="max-h-9 md:max-h-11"
            src={shop.tenant.branding.logo_url}
            alt={shop.tenant.name}
          />{:else}<span
            class="mq-tight max-w-[52vw] truncate text-[1.375rem] leading-none font-extrabold uppercase sm:text-[1.75rem] md:max-w-none md:text-[2.375rem]"
            >{shop.tenant.name}</span
          >{/if}
      </a>
      <div class="flex items-center justify-end gap-4 md:gap-7">
        {#if account}<a
            class="mq-link hidden text-[1.0625rem] leading-none font-bold uppercase lg:block"
            href={account}
            aria-current={path === account ? 'page' : undefined}>{accountLabel}</a
          >{/if}
        <a
          class="flex items-center gap-2 text-[1.0625rem] leading-none font-bold uppercase"
          href={rt.url.cart()}
          ><span class="mq-link sr-only sm:not-sr-only">{rt.t('nav.cart')}</span><span
            aria-hidden="true"
            class={[
              'mq-mono grid h-7 min-w-7 place-items-center border px-1 text-[0.8125rem] font-medium',
              shop.cartCount
                ? 'border-(--mq-accent) bg-(--mq-accent) text-(--mq-on-accent)'
                : 'border-(--mq-ink)',
            ]}>{pad(shop.cartCount)}</span
          >{#if shop.cartCount}<span class="sr-only">({shop.cartCount})</span>{/if}</a
        >
        <Sheet.Root bind:open={menu}>
          <Sheet.Trigger class="group flex items-center gap-3 text-[1.0625rem] leading-none font-bold uppercase"
            ><span class="hidden md:inline">{rt.t('nav.menu')}</span><span
              class="mq-burger flex w-8 flex-col gap-[7px]"
              aria-hidden="true"
              ><span class="h-[2px] bg-current"></span><span class="h-[2px] bg-current"></span></span
            ><span class="sr-only md:hidden">{rt.t('nav.menu')}</span></Sheet.Trigger
          >
          <Sheet.Content
            side="right"
            class="mq-font w-full gap-0 border-l border-(--mq-ink) bg-(--mq-paper) p-0 text-(--mq-ink) sm:max-w-md"
          >
            <Sheet.Header class="border-b border-(--mq-ink) px-6 py-5"
              ><Sheet.Title class="mq-tight text-[2.5rem] leading-none font-bold uppercase"
                >{rt.t('nav.menu')}</Sheet.Title
              ></Sheet.Header
            >
            <nav class="flex flex-col overflow-y-auto" aria-label={rt.t('nav.categories')}>
              {#each links as l, i (l.href)}<a
                  class="mq-fill flex items-center gap-4 border-b border-(--mq-ink) px-6 py-3 aria-[current=page]:text-(--mq-accent)"
                  href={l.href}
                  aria-current={path === l.href ? 'page' : undefined}
                  onclick={() => (menu = false)}
                  ><span class="mq-mono w-6 shrink-0 text-xs">{pad(i + 1)}</span><span
                    class="mq-tight text-[2.25rem] leading-[0.95] font-bold uppercase">{l.label}</span
                  ></a
                >{/each}
            </nav>
            <div class="mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-(--mq-ink) px-6 py-5">
              {#if account}<a
                  class="mq-link text-lg font-bold uppercase"
                  href={account}
                  onclick={() => (menu = false)}>{accountLabel}</a
                >{/if}
              {#if searchUrl}<a class="mq-link text-lg font-bold uppercase" href={searchUrl} onclick={() => (menu = false)}
                  >{rt.t('nav.search')}</a
                >{/if}
              <LanguageMenu />
            </div>
          </Sheet.Content>
        </Sheet.Root>
      </div>
    </div>
  </header>

  <rt.components.Slot name="header.after" />
  {#if showDates}<div class={cn(wrap, 'pt-6 md:pt-10')}><DateBar /></div>{/if}
  <main id="main" class="flex-1">
    <div class={cn(wrap, 'py-8 md:py-12')}>{@render children()}</div>
  </main>
  <rt.components.Slot name="footer.before" />

  <footer class="bg-(--mq-ink) text-(--mq-paper) [--mq-rule:rgb(245_245_243/0.28)]">
    <div class={cn(wrap, 'grid gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16')}>
      <div class="flex min-w-0 flex-col gap-8">
        <h2 class="mq-tight text-[clamp(2rem,3.6vw,2.75rem)] leading-[0.95] font-bold uppercase">
          {rt.t('footer.heading')}
        </h2>
        {#if searchUrl}
          <form class="flex items-stretch gap-4" method="GET" action={searchUrl} role="search">
            <input
              class="mq-tight min-w-0 flex-1 border border-(--mq-rule) bg-transparent px-4 py-2 text-[clamp(2rem,4.2vw,4rem)] leading-none font-bold uppercase placeholder:text-[#8d8e95] focus-visible:border-(--mq-paper)"
              name="q"
              type="search"
              placeholder={rt.t('footer.search_placeholder')}
              aria-label={rt.t('search.label')}
            />
            <button
              class="mq-fill grid aspect-square w-[clamp(3.5rem,7vw,5.5rem)] shrink-0 place-items-center border border-(--mq-rule) [--mq-fill:var(--mq-paper)] [--mq-fill-text:var(--mq-ink)]"
              type="submit"
              aria-label={rt.t('search.submit')}><ArrowRightIcon class="mq-arrow size-7" aria-hidden="true" /></button
            >
          </form>
        {/if}
        <p class="max-w-md text-lg leading-snug font-semibold uppercase">{rt.t('footer.text')}</p>
      </div>
      <div class="flex min-w-0 flex-col gap-8">
        <h2 class="mq-tight text-[clamp(2rem,3.6vw,2.75rem)] leading-[0.95] font-bold uppercase">
          {rt.t('footer.counter')}
        </h2>
        <div class="mq-cells grid grid-cols-2 sm:grid-cols-4">
          <a
            class="mq-fill col-span-2 row-span-2 flex min-h-56 flex-col justify-between gap-4 p-5 [--mq-fill:var(--mq-accent)]"
            href={rt.url.home()}
            ><span class="mq-outline mq-tight text-[7rem] leading-[0.8] font-extrabold uppercase [--mq-stroke:var(--mq-paper)]"
              >{shop.tenant.name.slice(0, 1)}</span
            ><span class="mq-tight text-3xl leading-[0.9] font-bold break-words uppercase">{shop.tenant.name}</span></a
          >
          {#if loc}<div class="col-span-2 flex min-h-28 flex-col gap-2 p-5">
              <span class="text-[0.8125rem] font-semibold tracking-[0.04em] text-[#b9bac1] uppercase"
                >{rt.t('footer.pickup')}</span
              >
              <span class="text-xl leading-tight font-bold uppercase">{loc.name}</span>
              {#each address as a (a)}<span class="text-base leading-tight uppercase">{a}</span>{/each}
            </div>{/if}
          {#if hours.length}<div class="col-span-2 flex flex-col gap-2 p-5">
              <span class="text-[0.8125rem] font-semibold tracking-[0.04em] text-[#b9bac1] uppercase"
                >{rt.t('footer.hours')}</span
              >
              <dl class="mq-mono grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[0.8125rem] uppercase">
                {#each hours as h (h.day)}<dt>{h.day}</dt>
                  <dd class={h.time ? '' : 'text-[#b9bac1]'}>{h.time || rt.t('dates.closed_short')}</dd>{/each}
              </dl>
            </div>{/if}
          {#each footerLinks as l (l.href)}<a
              class="mq-fill flex min-h-24 items-start justify-between gap-2 p-4 text-lg leading-tight font-bold uppercase [--mq-fill:var(--mq-paper)] [--mq-fill-text:var(--mq-ink)]"
              href={l.href}
              ><span class="break-words">{l.label}</span><ArrowUpRightIcon
                class="mq-arrow size-4 shrink-0"
                aria-hidden="true"
              /></a
            >{/each}
        </div>
      </div>
    </div>
    <div
      class={cn(
        wrap,
        'flex flex-wrap items-center justify-between gap-3 border-t border-(--mq-rule) py-6 text-[0.8125rem] font-semibold tracking-[0.04em] uppercase',
      )}
    >
      <span class="mq-mono font-normal normal-case">{rt.t('footer.copyright', {
          year: new Date().getFullYear(),
          shop: shop.tenant.name,
        })}</span>
      {#if shop.settings.show_powered_by !== false}<a
          class="mq-link"
          href="https://openrent.dev"
          rel="noopener">{rt.t('footer.powered')}</a
        >{/if}
    </div>
  </footer>
</div>
