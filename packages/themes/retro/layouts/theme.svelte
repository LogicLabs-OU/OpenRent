<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import * as Sheet from '@openrent/ui/sheet';
  import { cn } from '@openrent/ui/utils';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';
  import SearchIcon from '@lucide/svelte/icons/search';
  import '../assets/retro.css';
  import DateBar from '../snippets/DateBar.svelte';
  import LanguageMenu from '../snippets/LanguageMenu.svelte';
  import { retroCss, wrap } from '../lib/retro.ts';

  let { children, path }: { children: Snippet; path: string } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const css = $derived(
    retroCss(shop.settings.accent || shop.tenant.branding.primary_color, shop.settings.highlight),
  );
  const loc = $derived(shop.locations[0]);
  const address = $derived([loc?.address?.line1, loc?.address?.city].filter(Boolean).join(', '));
  // The home page carries the date search in its hero; checkout and orders do not need it.
  // `path` includes the language prefix (/de/...), so compare with the runtime's URLs.
  const showDates = $derived(path !== rt.url.home() && !path.startsWith(rt.url.order('')) && !path.startsWith(rt.url.checkout()));
  const cartLabel = $derived(shop.cartCount ? `${rt.t('nav.cart')} (${shop.cartCount})` : rt.t('nav.cart'));
  let menu = $state(false);

  // The header bar lists categories only (the shop name links home); the menu and footer list everything.
  const links = $derived([
    { href: rt.url.home(), label: rt.t('nav.all') },
    ...shop.categories.map((c) => ({ href: rt.url.category(c.slug), label: c.name })),
  ]);
</script>

<svelte:head>
  {@html `<style>${css}</style>`}
</svelte:head>

<div class="bg-background text-foreground flex min-h-svh flex-col">
  <a
    class="sr-only z-50 bg-black px-3 py-2 text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    href="#main">{rt.t('a11y.skip')}</a
  >
  <header class="sticky top-0 z-30 border-b border-black bg-white">
    <div class="flex h-16 items-stretch md:h-20">
      <a
        class="flex min-w-0 shrink-0 items-center px-4 text-2xl font-semibold tracking-tight md:px-8 md:text-3xl"
        href={rt.url.home()}
      >
        {#if shop.tenant.branding.logo_url}<img
            class="max-h-10"
            src={shop.tenant.branding.logo_url}
            alt={shop.tenant.name}
          />{:else}<span class="truncate">{shop.tenant.name}</span>{/if}
      </a>
      <nav
        class="hidden min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto px-4 [scrollbar-width:none] xl:flex"
        aria-label={rt.t('nav.categories')}
      >
        {#each links.slice(1) as l (l.href)}
          {@const active = path === l.href}
          <Button
            variant="ghost"
            href={l.href}
            aria-current={active ? 'page' : undefined}
            class={cn(
              'h-11 rounded-full px-4 text-base font-normal hover:bg-black/5',
              active && 'bg-black text-white hover:bg-black hover:text-white',
            )}>{l.label}</Button
          >
        {/each}
      </nav>
      <div class="ml-auto flex items-stretch xl:ml-0">
        <LanguageMenu />
        {#if rt.url.search}
          <Button
            variant="ghost"
            href={rt.url.search()}
            aria-label={rt.t('search.label')}
            class="h-full w-14 rounded-none border-l border-black text-base font-normal hover:bg-(--retro-accent) hover:text-(--retro-accent-ink) md:w-16"
            ><SearchIcon class="size-5" /></Button
          >
        {/if}
        {#if rt.url.account}
          <Button
            variant="ghost"
            href={shop.customer ? rt.url.account() : (rt.url.accountLogin?.() ?? rt.url.account())}
            aria-label={shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}
            class="h-full gap-2 rounded-none border-l border-black px-4 text-base font-normal hover:bg-(--retro-accent) hover:text-(--retro-accent-ink) md:px-6"
          >
            <UserRoundIcon class="size-5" /><span class="hidden sm:inline"
              >{shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}</span
            >
          </Button>
        {/if}
        <Button
          variant="ghost"
          href={rt.url.cart()}
          aria-label={cartLabel}
          class="h-full gap-2 rounded-none border-l border-black px-4 text-base font-normal hover:bg-(--retro-accent) hover:text-(--retro-accent-ink) md:px-6"
        >
          <ShoppingBagIcon class="size-5" /><span class="hidden sm:inline">{rt.t('nav.cart')}</span>
          {#if shop.cartCount}<span
              class="grid size-6 place-items-center rounded-full border border-black bg-(--retro-accent) text-sm text-(--retro-accent-ink) tabular-nums"
              >{shop.cartCount}</span
            >{/if}
        </Button>
        <Button
          href={`${rt.url.home()}#catalog`}
          class="hidden h-full rounded-none bg-black px-6 text-base font-normal text-white hover:bg-(--retro-accent) hover:text-(--retro-accent-ink) min-[1400px]:inline-flex"
          >{rt.t('nav.cta')}</Button
        >
        <Sheet.Root bind:open={menu}>
          <Sheet.Trigger
            class="grid w-16 place-items-center border-l border-black xl:hidden"
            aria-label={rt.t('nav.menu')}><MenuIcon class="size-6" /></Sheet.Trigger
          >
          <Sheet.Content side="right" class="gap-0 border-l border-black bg-white p-0">
            <Sheet.Header class="h-16 justify-center border-b border-black px-4">
              <Sheet.Title class="text-xl font-normal">{rt.t('nav.menu')}</Sheet.Title>
            </Sheet.Header>
            <nav class="flex flex-col" aria-label={rt.t('nav.categories')}>
              {#each links as l (l.href)}
                <a
                  class={cn(
                    'border-b border-black px-4 py-4 text-lg',
                    path === l.href ? 'bg-black text-white' : 'hover:bg-(--retro-accent)',
                  )}
                  href={l.href}
                  aria-current={path === l.href ? 'page' : undefined}
                  onclick={() => (menu = false)}>{l.label}</a
                >
              {/each}
            </nav>
          </Sheet.Content>
        </Sheet.Root>
      </div>
    </div>
  </header>
  <rt.components.Slot name="header.after" />
  {#if showDates}<DateBar />{/if}
  <main id="main" class="flex-1">{@render children()}</main>
  <rt.components.Slot name="footer.before" />
  <div class="mt-16 border-t border-black" aria-hidden="true">
    <div class="h-8 bg-[#23a094]"></div>
    <div
      class="h-14 border-y border-black bg-(--retro-highlight) bg-[repeating-linear-gradient(-60deg,transparent_0_120px,#000_120px_121.5px,transparent_121.5px_128px,#000_128px_129.5px,transparent_129.5px_260px)]"
    ></div>
    <div class="h-6 bg-[#23a094]"></div>
  </div>
  <footer class="bg-black text-white">
    <div class={[wrap, 'grid gap-12 py-14 md:grid-cols-[1.4fr_1fr_1fr] md:py-20']}>
      <div class="flex flex-col gap-6">
        <p class="text-3xl leading-tight tracking-tight text-balance md:text-5xl">
          {String(shop.settings.footer_heading ?? '')}
        </p>
        {#if loc}<p class="text-white/70">{loc.name}{address ? ` · ${address}` : ''}</p>{/if}
      </div>
      <nav class="flex flex-col gap-3" aria-label={rt.t('footer.shop')}>
        {#each links as l (l.href)}<a class="w-fit underline-offset-4 hover:underline" href={l.href}
            >{l.label}</a
          >{/each}
      </nav>
      <nav class="flex flex-col gap-3" aria-label={rt.t('footer.info')}>
        <a class="w-fit underline-offset-4 hover:underline" href={rt.url.cart()}>{rt.t('nav.cart')}</a>
        <a class="w-fit underline-offset-4 hover:underline" href={rt.url.page('terms')}
          >{rt.t('footer.terms')}</a
        >
        {#if shop.settings.show_powered_by !== false}<a
            class="w-fit underline-offset-4 hover:underline"
            href="https://openrent.dev"
            rel="noopener">{rt.t('footer.powered')}</a
          >{/if}
      </nav>
      <p class="flex items-center gap-3 md:col-span-3">
        <span
          class="grid size-7 place-items-center rounded-full border border-white bg-(--retro-accent) text-sm font-bold text-(--retro-accent-ink)"
          aria-hidden="true">{shop.tenant.name[0]}</span
        >
        {rt.t('footer.copyright', { year: new Date().getFullYear(), shop: shop.tenant.name })}
      </p>
    </div>
  </footer>
</div>
