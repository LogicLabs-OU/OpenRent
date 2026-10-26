<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Separator } from '@openrent/ui/separator';
  import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';
  import SearchIcon from '@lucide/svelte/icons/search';
  import * as InputGroup from '@openrent/ui/input-group';
  import { cn } from '@openrent/ui/utils';
  import DateBar from '../snippets/DateBar.svelte';
  import LanguageMenu from '../snippets/LanguageMenu.svelte';
  import { brandCss } from '../lib/brand.ts';

  let { children, path }: { children: Snippet; path: string } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const accent = $derived((shop.settings.accent as string) || shop.tenant.branding.primary_color || '');
  const css = $derived(brandCss(accent, Number(shop.settings.radius ?? 10)));
  const loc = $derived(shop.locations[0]);
  // `path` includes the language prefix (/de/...), so compare with the runtime's URLs.
  const showDates = $derived(!path.startsWith(rt.url.order('')) && !path.startsWith(rt.url.checkout()));
</script>

<svelte:head>
  {#if css}{@html `<style>${css}</style>`}{/if}
</svelte:head>

<div class="bg-background text-foreground flex min-h-svh flex-col">
  <a
    class="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    href="#main">{rt.t('a11y.skip')}</a
  >
  <header class="bg-background/95 supports-[backdrop-filter]:bg-background/80 border-b backdrop-blur">
    <div class="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4">
      <a class="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight" href={rt.url.home()}>
        {#if shop.tenant.branding.logo_url}<img
            class="max-h-9"
            src={shop.tenant.branding.logo_url}
            alt={shop.tenant.name}
          />{:else}{shop.tenant.name}{/if}
      </a>
      <nav
        class="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
        aria-label={rt.t('nav.categories')}
      >
        <Button
          variant="ghost"
          size="sm"
          href={rt.url.home()}
          aria-current={path === rt.url.home() ? 'page' : undefined}
          class={cn('text-muted-foreground', path === rt.url.home() && 'text-foreground bg-accent')}
          >{rt.t('nav.all')}</Button
        >
        {#each shop.categories as c (c.id)}
          {@const active = path === rt.url.category(c.slug)}
          <Button
            variant="ghost"
            size="sm"
            href={rt.url.category(c.slug)}
            aria-current={active ? 'page' : undefined}
            class={cn('text-muted-foreground', active && 'text-foreground bg-accent')}>{c.name}</Button
          >
        {/each}
      </nav>
      {#if rt.url.search}
        <form method="GET" action={rt.url.search()} role="search" class="hidden lg:block">
          <InputGroup.Root class="w-52">
            <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
            <InputGroup.Input
              name="q"
              type="search"
              placeholder={rt.t('search.placeholder')}
              aria-label={rt.t('search.label')}
            />
          </InputGroup.Root>
        </form>
        <Button
          variant="ghost"
          size="icon"
          class="lg:hidden"
          href={rt.url.search()}
          aria-label={rt.t('search.label')}><SearchIcon /></Button
        >
      {/if}
      <LanguageMenu />
      {#if rt.url.account}
        <Button
          variant="ghost"
          href={shop.customer ? rt.url.account() : (rt.url.accountLogin?.() ?? rt.url.account())}
          aria-label={shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}
        >
          <UserRoundIcon /><span class="hidden sm:inline"
            >{shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}</span
          >
        </Button>
      {/if}
      <Button
        variant="outline"
        href={rt.url.cart()}
        aria-label={shop.cartCount ? `${rt.t('nav.cart')} (${shop.cartCount})` : rt.t('nav.cart')}
      >
        <ShoppingCartIcon />
        <span class="hidden sm:inline">{rt.t('nav.cart')}</span>
        {#if shop.cartCount}<Badge class="h-5 min-w-5 rounded-full px-1.5 tabular-nums"
            >{shop.cartCount}</Badge
          >{/if}
      </Button>
    </div>
  </header>
  <rt.components.Slot name="header.after" />
  {#if showDates}<DateBar />{/if}
  <main id="main" class="flex-1">
    <div class="mx-auto w-full max-w-6xl px-4 py-8 md:py-10">{@render children()}</div>
  </main>
  <rt.components.Slot name="footer.before" />
  <footer class="border-t">
    <div
      class="text-muted-foreground mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm"
    >
      <span>
        {shop.tenant.name}{#if loc}{' · '}{loc.name}{loc.address?.line1 ? `, ${loc.address.line1}` : ''}{loc
            .address?.city
            ? `, ${loc.address.city}`
            : ''}{/if}
      </span>
      <span class="flex items-center gap-3">
        <a class="hover:text-foreground underline-offset-4 hover:underline" href={rt.url.page('terms')}
          >{rt.t('footer.terms')}</a
        >
        {#if shop.settings.show_powered_by !== false}
          <Separator orientation="vertical" class="h-4" />
          <a
            class="hover:text-foreground underline-offset-4 hover:underline"
            href="https://openrent.dev"
            rel="noopener">{rt.t('footer.powered')}</a
          >
        {/if}
      </span>
    </div>
  </footer>
</div>
