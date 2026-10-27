<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import * as Sheet from '@openrent/ui/sheet';
  import { cn } from '@openrent/ui/utils';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
  import '../assets/ink-green.css';
  import DateBar from '../snippets/DateBar.svelte';
  import LanguageMenu from '../snippets/LanguageMenu.svelte';
  import { big, ghostLine, inkCss, wrap } from '../lib/ink.ts';

  /** A lime notice strip, a sage nav bar that hangs from the top edge, the page, and a footer with a big wordmark. */
  let { children, path }: { children: Snippet; path: string } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const css = $derived(inkCss(shop.settings.ink, shop.settings.highlight));
  const loc = $derived(shop.location ?? shop.locations[0]);
  const notice = $derived(String(shop.settings.announcement ?? '').trim());
  // The home page carries the date search in its hero; checkout and orders do not need it.
  // `path` includes the language prefix (/de/...), so compare with the runtime's URLs.
  const showDates = $derived(
    path !== rt.url.home() && !path.startsWith(rt.url.order('')) && !path.startsWith(rt.url.checkout()),
  );
  const account = $derived(
    shop.customer ? rt.url.account?.() : (rt.url.accountLogin?.() ?? rt.url.account?.()),
  );
  const cartLabel = $derived(shop.cartCount ? `${rt.t('nav.cart')} (${shop.cartCount})` : rt.t('nav.cart'));
  let menu = $state(false);
  /** The bar holds a few links like the reference site; the menu lists the rest. */
  const BAR_LINKS = 5;
  // The shop's own header menu (theme API 1.9) takes the place of the categories when it has links.
  const links = $derived(
    shop.navigation?.header.length
      ? shop.navigation.header.map((l) => ({ href: l.href, label: l.label }))
      : [
          { href: rt.url.home(), label: rt.t('nav.all') },
          ...shop.categories.map((c) => ({ href: rt.url.category(c.slug), label: c.name })),
        ],
  );
</script>

<svelte:head>
  {@html `<style>${css}</style>`}
</svelte:head>

<div class="bg-background text-foreground flex min-h-svh flex-col">
  <a
    class="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    href="#main">{rt.t('a11y.skip')}</a
  >
  {#if notice}<p class="bg-primary text-primary-foreground px-4 py-2.5 text-center text-sm">{notice}</p>{/if}

  <header class={cn(wrap, 'sticky top-0 z-30')}>
    <div
      class="ink-light bg-card text-card-foreground flex h-16 items-center gap-2 rounded-b-2xl px-4 shadow-[0_8px_24px_rgba(0,0,0,0.18)] md:h-20 md:gap-4 md:px-6"
    >
      <a class="flex min-w-0 shrink-0 items-center gap-2" href={rt.url.home()}>
        {#if shop.tenant.branding.logo_url}<img
            class="max-h-9"
            src={shop.tenant.branding.logo_url}
            alt={shop.tenant.name}
          />{:else}<span
            class="ink-serif truncate text-2xl font-semibold tracking-[-0.02em] md:text-[1.75rem]"
            >{shop.tenant.name}</span
          >{/if}
      </a>
      <nav class="hidden min-w-0 flex-1 gap-1 overflow-hidden xl:flex" aria-label={rt.t('nav.categories')}>
        {#each links.slice(0, BAR_LINKS) as l (l.href)}
          {@const active = path === l.href}
          <a
            class={[
              'rounded-[4px] px-3 py-2 text-[0.9375rem] font-medium whitespace-nowrap underline-offset-[6px] hover:underline',
              active && 'underline decoration-2',
            ]}
            href={l.href}
            aria-current={active ? 'page' : undefined}>{l.label}</a
          >
        {/each}
      </nav>
      <div class="ml-auto flex items-center gap-1 md:gap-2 xl:ml-0">
        {#if rt.url.search}<Button
            variant="ghost"
            size="icon"
            href={rt.url.search()}
            aria-label={rt.t('search.label')}><SearchIcon /></Button
          >{/if}
        <LanguageMenu />
        {#if account}<Button variant="outline" class={cn(ghostLine, 'hidden md:inline-flex')} href={account}
            >{shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}</Button
          >{/if}
        <Button class={cn(big, 'px-4 md:px-6')} href={rt.url.cart()} aria-label={cartLabel}>
          <ShoppingCartIcon /><span class="hidden sm:inline">{rt.t('nav.cart')}</span
          >{#if shop.cartCount}<span class="tabular-nums">{shop.cartCount}</span>{/if}
        </Button>
        <Sheet.Root bind:open={menu}>
          <Sheet.Trigger
            class={[
              'hover:bg-accent grid size-10 place-items-center rounded-[4px]',
              links.length <= BAR_LINKS && 'xl:hidden',
            ]}
            aria-label={rt.t('nav.menu')}><MenuIcon class="size-5" /></Sheet.Trigger
          >
          <Sheet.Content side="right" class="gap-0 p-0">
            <Sheet.Header class="px-6 pt-6"
              ><Sheet.Title class="ink-serif text-3xl">{rt.t('nav.menu')}</Sheet.Title></Sheet.Header
            >
            <nav class="flex flex-col px-3 py-4" aria-label={rt.t('nav.categories')}>
              {#each links as l (l.href)}<a
                  class="hover:bg-accent rounded-[4px] px-3 py-3 text-lg font-medium"
                  href={l.href}
                  aria-current={path === l.href ? 'page' : undefined}
                  onclick={() => (menu = false)}>{l.label}</a
                >{/each}
              {#if account}<a
                  class="hover:bg-accent rounded-[4px] px-3 py-3 text-lg font-medium"
                  href={account}
                  onclick={() => (menu = false)}
                  >{shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}</a
                >{/if}
            </nav>
          </Sheet.Content>
        </Sheet.Root>
      </div>
    </div>
  </header>

  <rt.components.Slot name="header.after" />
  {#if showDates}<div class={cn(wrap, 'mt-6')}><DateBar /></div>{/if}
  <main id="main" class="flex-1">
    <div class={cn(wrap, 'py-8 md:py-12')}>{@render children()}</div>
  </main>
  <rt.components.Slot name="footer.before" />

  <footer class="mt-10 border-t border-(--border)">
    <div class={cn(wrap, 'grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]')}>
      <div class="flex flex-col gap-4">
        <a
          href={rt.url.home()}
          class="ink-serif text-primary w-fit text-6xl leading-none font-semibold tracking-[-0.03em] break-words md:text-7xl"
          >{shop.tenant.name}</a
        >
        {#if loc}<p class="text-muted-foreground text-sm">
            {loc.name}{loc.address?.line1 ? `, ${loc.address.line1}` : ''}{loc.address?.city
              ? `, ${loc.address.city}`
              : ''}
          </p>{/if}
      </div>
      <nav class="flex flex-col gap-2 text-sm" aria-labelledby="ink-footer-shop">
        <h2 id="ink-footer-shop" class="text-primary mb-1 font-medium">{rt.t('footer.shop')}</h2>
        {#each links as l (l.href)}<a class="w-fit hover:underline" href={l.href}>{l.label}</a>{/each}
      </nav>
      <nav class="flex flex-col gap-2 text-sm" aria-labelledby="ink-footer-info">
        <h2 id="ink-footer-info" class="text-primary mb-1 font-medium">{rt.t('footer.info')}</h2>
        <a class="w-fit hover:underline" href={rt.url.page('terms')}>{rt.t('footer.terms')}</a>
        {#each shop.navigation?.footer ?? [] as l (l.href)}<a class="w-fit hover:underline" href={l.href}
            >{l.label}</a
          >{/each}
        {#if account}<a class="w-fit hover:underline" href={account}
            >{shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}</a
          >{/if}
        <a class="w-fit hover:underline" href={rt.url.cart()}>{rt.t('nav.cart')}</a>
      </nav>
    </div>
    <div
      class={cn(
        wrap,
        'text-muted-foreground flex flex-wrap justify-between gap-2 border-t border-(--border) py-5 text-xs',
      )}
    >
      <span>{rt.t('footer.copyright', { year: new Date().getFullYear(), shop: shop.tenant.name })}</span>
      {#if shop.settings.show_powered_by !== false}<a
          class="hover:text-foreground hover:underline"
          href="https://openrent.dev"
          rel="noopener">{rt.t('footer.powered')}</a
        >{/if}
    </div>
  </footer>
</div>
