<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import * as Sheet from '@openrent/ui/sheet';
  import { cn } from '@openrent/ui/utils';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
  import UserIcon from '@lucide/svelte/icons/user';
  import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import '../assets/nightfall.css';
  import DateBar from '../snippets/DateBar.svelte';
  import LanguageMenu from '../snippets/LanguageMenu.svelte';
  import { nightfallCss, wrap } from '../lib/nightfall.ts';

  /** A translucent black bar with centred links, the page, a black footer and an optional floating glass pill. */
  let { children, path }: { children: Snippet; path: string } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const css = $derived(nightfallCss(shop.settings));
  const loc = $derived(shop.locations[0]);
  const notice = $derived(String(shop.settings.announcement ?? '').trim());
  // The home page carries the date search in its hero; checkout and orders do not need it.
  // `path` includes the language prefix (/de/...), so compare with the runtime's URLs.
  const home = $derived(path === rt.url.home());
  const showDates = $derived(
    !home && !path.startsWith(rt.url.order('')) && !path.startsWith(rt.url.checkout()),
  );
  const account = $derived(
    shop.customer ? rt.url.account?.() : (rt.url.accountLogin?.() ?? rt.url.account?.()),
  );
  const accountLabel = $derived(shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in'));
  const cartLabel = $derived(shop.cartCount ? `${rt.t('nav.cart')} (${shop.cartCount})` : rt.t('nav.cart'));
  let menu = $state(false);
  /** The bar holds a few links like the reference site; the menu lists the rest. */
  const BAR_LINKS = 5;
  const links = $derived([
    { href: rt.url.home(), label: rt.t('nav.all') },
    ...shop.categories.map((c) => ({ href: rt.url.category(c.slug), label: c.name })),
  ]);
  const off = (key: string) => (shop.settings[key] === false ? 'off' : undefined);
  // The floating pill leads to the cart or to the questions; it stays out of the way on cart and checkout.
  const floating = $derived.by(() => {
    const kind = String(shop.settings.floating_button ?? 'cart');
    if (kind === 'none' || path.startsWith(rt.url.checkout()) || path.startsWith(rt.url.cart())) return null;
    if (kind === 'questions')
      return {
        href: String(shop.settings.floating_link || '') || `${rt.url.home()}#faq`,
        label: rt.t('floating.questions'),
        icon: MessageCircleIcon,
      };
    return { href: rt.url.cart(), label: rt.t('floating.cart'), icon: ShoppingCartIcon };
  });
  const iconBtn =
    'size-10 rounded-full text-white/80 hover:bg-white/10 hover:text-white dark:hover:bg-white/10';
</script>

<svelte:head>
  {@html `<style>${css}</style>`}
</svelte:head>

<div
  class="dark bg-background text-foreground flex min-h-svh flex-col"
  data-nf-glows={off('glows')}
  data-nf-dots={off('dotted_grids')}
  data-nf-motion={off('scroll_effects')}
>
  <a
    class="bg-primary text-primary-foreground sr-only z-50 rounded-full px-4 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    href="#main">{rt.t('a11y.skip')}</a
  >
  {#if notice}<p
      class="flex items-center justify-center gap-2 border-b border-white/10 bg-[#0b0a12] px-4 py-2.5 text-center text-[0.8125rem] text-white/80"
    >
      <span class="size-1.5 shrink-0 rounded-full bg-(--nf-accent) shadow-[0_0_10px_var(--nf-accent)]" aria-hidden="true"
      ></span>{notice}
    </p>{/if}

  <header class="sticky top-0 z-30 border-b border-white/10 bg-black/70 backdrop-blur-xl backdrop-saturate-150">
    <div class={cn(wrap, 'flex h-14 items-center gap-3 md:h-16 xl:grid xl:grid-cols-[1fr_auto_1fr]')}>
      <a class="flex min-w-0 items-center gap-2.5" href={rt.url.home()}>
        {#if shop.tenant.branding.logo_url}<img
            class="max-h-8"
            src={shop.tenant.branding.logo_url}
            alt={shop.tenant.name}
          />{:else}<span
            class="grid size-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-b from-white to-white/70 text-sm font-bold text-black"
            aria-hidden="true">{shop.tenant.name.slice(0, 1).toUpperCase()}</span
          ><span class="truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">{shop.tenant.name}</span>{/if}
      </a>
      <nav class="hidden items-center gap-1 xl:flex" aria-label={rt.t('nav.categories')}>
        {#each links.slice(0, BAR_LINKS) as l (l.href)}
          {@const active = path === l.href}
          <a
            class={[
              'rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-white/10 hover:text-white',
              active ? 'text-white' : 'text-white/75',
            ]}
            href={l.href}
            aria-current={active ? 'page' : undefined}>{l.label}</a
          >
        {/each}
      </nav>
      <div class="ml-auto flex items-center gap-0.5 xl:justify-self-end">
        {#if rt.url.search}<Button
            variant="ghost"
            size="icon"
            class={cn(iconBtn, 'hidden sm:inline-flex')}
            href={rt.url.search()}
            aria-label={rt.t('search.label')}><SearchIcon /></Button
          >{/if}
        <LanguageMenu />
        {#if account}<Button
            variant="ghost"
            size="icon"
            class={cn(iconBtn, 'hidden md:inline-flex')}
            href={account}
            aria-label={accountLabel}><UserIcon /></Button
          >{/if}
        <Button variant="ghost" size="icon" class={cn(iconBtn, 'relative')} href={rt.url.cart()} aria-label={cartLabel}>
          <ShoppingCartIcon />{#if shop.cartCount}<span
              class="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-(--nf-accent) px-1 text-[0.6875rem] font-bold text-white tabular-nums"
              aria-hidden="true">{shop.cartCount}</span
            >{/if}
        </Button>
        <Sheet.Root bind:open={menu}>
          <Sheet.Trigger
            class={[
              'grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white',
              links.length <= BAR_LINKS && 'xl:hidden',
            ]}
            aria-label={rt.t('nav.menu')}><MenuIcon class="size-5" /></Sheet.Trigger
          >
          <Sheet.Content side="right" class="gap-0 p-0">
            <Sheet.Header class="px-6 pt-6"
              ><Sheet.Title class="text-2xl font-semibold tracking-[-0.02em]">{rt.t('nav.menu')}</Sheet.Title
              ></Sheet.Header
            >
            <nav class="flex flex-col overflow-y-auto px-3 py-4" aria-label={rt.t('nav.categories')}>
              {#each links as l (l.href)}<a
                  class={[
                    'rounded-2xl px-3 py-3 text-lg font-medium hover:bg-white/5',
                    path === l.href ? 'text-white' : 'text-white/75',
                  ]}
                  href={l.href}
                  aria-current={path === l.href ? 'page' : undefined}
                  onclick={() => (menu = false)}>{l.label}</a
                >{/each}
              <hr class="mx-3 my-3 border-white/10" />
              {#if rt.url.search}<a
                  class="rounded-2xl px-3 py-3 text-lg font-medium text-white/75 hover:bg-white/5"
                  href={rt.url.search()}
                  onclick={() => (menu = false)}>{rt.t('search.title')}</a
                >{/if}
              {#if account}<a
                  class="rounded-2xl px-3 py-3 text-lg font-medium text-white/75 hover:bg-white/5"
                  href={account}
                  onclick={() => (menu = false)}>{accountLabel}</a
                >{/if}
            </nav>
          </Sheet.Content>
        </Sheet.Root>
      </div>
    </div>
  </header>

  <rt.components.Slot name="header.after" />
  {#if showDates}<div class={cn(wrap, 'relative z-10 mt-5')}><DateBar /></div>{/if}
  <main id="main" class="flex-1 overflow-x-clip">
    <div class={cn(wrap, home ? 'pt-10 pb-8 md:pt-16' : 'py-10 md:py-14')}>{@render children()}</div>
  </main>
  <rt.components.Slot name="footer.before" />

  <footer class="mt-16 border-t border-white/10 bg-black">
    <div class={cn(wrap, 'grid gap-12 py-16 md:grid-cols-[1.5fr_1fr_1fr]')}>
      <div class="flex flex-col gap-4">
        <a href={rt.url.home()} class="flex w-fit items-center gap-3">
          <span
            class="grid size-10 place-items-center rounded-xl bg-gradient-to-b from-white to-white/70 text-lg font-bold text-black"
            aria-hidden="true">{shop.tenant.name.slice(0, 1).toUpperCase()}</span
          >
          <span class="text-2xl font-semibold tracking-[-0.02em]">{shop.tenant.name}</span>
        </a>
        {#if loc}<p class="max-w-xs text-sm leading-relaxed text-white/60">
            {loc.name}{loc.address?.line1 ? `, ${loc.address.line1}` : ''}{loc.address?.city
              ? `, ${loc.address.city}`
              : ''}
          </p>{/if}
      </div>
      <nav class="flex flex-col gap-3 text-sm" aria-labelledby="nf-footer-shop">
        <h2 id="nf-footer-shop" class="mb-1 text-[0.9375rem] font-semibold text-white">{rt.t('footer.shop')}</h2>
        {#each links.slice(0, 8) as l (l.href)}<a class="w-fit text-white/60 transition-colors hover:text-white" href={l.href}
            >{l.label}</a
          >{/each}
      </nav>
      <nav class="flex flex-col gap-3 text-sm" aria-labelledby="nf-footer-info">
        <h2 id="nf-footer-info" class="mb-1 text-[0.9375rem] font-semibold text-white">{rt.t('footer.info')}</h2>
        <a class="w-fit text-white/60 transition-colors hover:text-white" href={rt.url.page('terms')}
          >{rt.t('footer.terms')}</a
        >
        {#if rt.url.search}<a class="w-fit text-white/60 transition-colors hover:text-white" href={rt.url.search()}
            >{rt.t('search.title')}</a
          >{/if}
        {#if account}<a class="w-fit text-white/60 transition-colors hover:text-white" href={account}>{accountLabel}</a
          >{/if}
        <a class="w-fit text-white/60 transition-colors hover:text-white" href={rt.url.cart()}>{rt.t('nav.cart')}</a>
      </nav>
    </div>
    <div class={wrap}>
      <div class="flex flex-wrap justify-between gap-2 border-t border-white/10 py-6 text-xs text-white/50">
        <span>{rt.t('footer.copyright', { year: new Date().getFullYear(), shop: shop.tenant.name })}</span>
        {#if shop.settings.show_powered_by !== false}<a
            class="transition-colors hover:text-white"
            href="https://openrent.dev"
            rel="noopener">{rt.t('footer.powered')}</a
          >{/if}
      </div>
    </div>
  </footer>

  {#if floating}
    {@const Icon = floating.icon}
    <a
      class="group fixed right-4 bottom-4 z-40 flex h-12 items-center gap-3 rounded-full border border-white/15 bg-[#18181b]/80 pr-1.5 pl-1.5 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-colors outline-none hover:border-white/30 focus-visible:ring-4 focus-visible:ring-ring/60 sm:pl-5 md:right-6 md:bottom-6"
      href={floating.href}
      aria-label={floating.label}
      data-testid="floating-pill"
    >
      <span class="hidden sm:inline">{floating.label}</span>
      <span class="grid size-9 place-items-center rounded-full bg-white text-black">
        <Icon class="size-4 group-hover:hidden" aria-hidden="true" /><ArrowRightIcon
          class="hidden size-4 group-hover:block"
          aria-hidden="true"
        />
      </span>
    </a>
  {/if}
</div>
