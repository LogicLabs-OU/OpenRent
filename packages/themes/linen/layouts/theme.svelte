<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import * as Sheet from '@openrent/ui/sheet';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { cn } from '@openrent/ui/utils';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import SearchIcon from '@lucide/svelte/icons/search';
  import XIcon from '@lucide/svelte/icons/x';
  import '../assets/linen.css';
  import DateBar from '../snippets/DateBar.svelte';
  import LanguageMenu from '../snippets/LanguageMenu.svelte';
  import { btn, linenCss, wrap } from '../lib/linen.ts';

  /**
   * An optional split notice (orange story, dark wordmark), a light header with a grey pill of menus in the middle,
   * the page, and a dark rounded footer with the shop name, a language toggle and an orange curve.
   */
  let { children, path }: { children: Snippet; path: string } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const css = $derived(linenCss(shop.settings));
  const loc = $derived(shop.location ?? shop.locations[0]);
  const notice = $derived(String(shop.settings.announcement ?? '').trim());
  const noticeText = $derived(String(shop.settings.announcement_text ?? '').trim());
  const noticeLink = $derived(String(shop.settings.announcement_link ?? '').trim());
  let noticeOpen = $state(true);
  // The home page carries the date search in its hero; checkout and orders do not need it.
  // `path` includes the language prefix (/de/...), so compare with the runtime's URLs.
  const showDates = $derived(
    path !== rt.url.home() && !path.startsWith(rt.url.order('')) && !path.startsWith(rt.url.checkout()),
  );
  const account = $derived(
    shop.customer ? rt.url.account?.() : (rt.url.accountLogin?.() ?? rt.url.account?.()),
  );
  const accountLabel = $derived(shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in'));
  const cartLabel = $derived(shop.cartCount ? `${rt.t('nav.cart')} (${shop.cartCount})` : rt.t('nav.cart'));
  let menu = $state(false);
  const cats = $derived(shop.categories.map((c) => ({ href: rt.url.category(c.slug), label: c.name })));
  // The shop's own header menu (theme API 1.9) takes the place of the categories when it has links.
  const own = $derived(shop.navigation?.header ?? []);
  const pill =
    'flex h-9 items-center gap-1 rounded-full px-3.5 text-[0.9375rem] whitespace-nowrap text-[#202020] transition-colors outline-none hover:bg-white focus-visible:ring-3 focus-visible:ring-[var(--ln-accent)]/40 aria-[current=page]:bg-white data-[state=open]:bg-white';
  const footLink = 'w-fit text-[0.9375rem] text-[#a8a8a8] transition-colors hover:text-white';
</script>

<svelte:head>
  {@html `<style>${css}</style>`}
</svelte:head>

<div
  class="bg-background text-foreground flex min-h-svh flex-col"
  data-ln-motion={shop.settings.motion === false ? 'off' : undefined}
>
  <a
    class="bg-primary text-primary-foreground sr-only z-50 rounded-full px-4 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    href="#main">{rt.t('a11y.skip')}</a
  >
  {#if notice && noticeOpen}
    <aside class="relative grid md:grid-cols-2" aria-label={rt.t('notice.label')}>
      <div
        class="flex flex-col items-start gap-3 bg-[var(--ln-signal)] px-5 py-7 pr-14 text-[#202020] md:px-10 md:py-12 lg:px-[105px]"
      >
        <p class="text-[0.8125rem] font-medium">{rt.t('notice.label')}</p>
        <p class="ln-display text-2xl leading-tight">{notice}</p>
        {#if noticeText}<p class="max-w-xl leading-relaxed">{noticeText}</p>{/if}
        {#if noticeLink}<a
            class="mt-2 inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
            href={noticeLink}>{rt.t('notice.more')}<ChevronRightIcon class="size-4" aria-hidden="true" /></a
          >{/if}
      </div>
      <div class="hidden items-center justify-center bg-[#202020] px-10 py-10 md:flex">
        <span
          class="ln-display max-w-full text-center text-5xl leading-none tracking-[-0.03em] break-words text-[#ebe6dd] lg:text-7xl"
          >{shop.tenant.name}</span
        >
      </div>
      <button
        type="button"
        class="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-white text-[#202020] outline-none hover:bg-[#ebe6dd] focus-visible:ring-3 focus-visible:ring-[#202020]/40"
        aria-label={rt.t('notice.close')}
        onclick={() => (noticeOpen = false)}><XIcon class="size-4" /></button
      >
    </aside>
  {/if}

  <header class="bg-background/90 sticky top-0 z-30 backdrop-blur-md" data-ln-header>
    <div class={cn(wrap, 'flex h-[72px] items-center gap-3 md:h-20 lg:grid lg:grid-cols-[1fr_auto_1fr]')}>
      <a class="flex min-w-0 items-center gap-2 rounded-md" href={rt.url.home()}>
        {#if shop.tenant.branding.logo_url}<img
            class="max-h-9"
            src={shop.tenant.branding.logo_url}
            alt={shop.tenant.name}
          />{:else}<span
            class="ln-display truncate text-[1.375rem] leading-none tracking-[-0.03em] sm:text-[1.625rem] md:text-[2rem]"
            >{shop.tenant.name}</span
          >{/if}
      </a>
      <nav class="hidden rounded-full bg-[var(--ln-panel)] p-1 lg:flex" aria-label={rt.t('nav.categories')}>
        {#each own as l (l.href)}<a
            class={pill}
            href={l.href}
            aria-current={path === l.href ? 'page' : undefined}>{l.label}</a
          >{/each}
        {#if !own.length && cats.length}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class={pill}
              >{rt.t('nav.categories')}<ChevronDownIcon
                class="size-3.5 opacity-60"
                aria-hidden="true"
              /></DropdownMenu.Trigger
            >
            <DropdownMenu.Content
              align="center"
              sideOffset={10}
              class={['grid gap-0.5 p-2', cats.length > 6 ? 'w-[30rem] grid-cols-2' : 'w-64']}
            >
              {#each cats as l (l.href)}
                <DropdownMenu.Item class="rounded-lg px-3 py-2.5 text-[0.9375rem]">
                  {#snippet child({ props })}
                    <a {...props} href={l.href} aria-current={path === l.href ? 'page' : undefined}
                      ><span class="ln-square size-1.5" aria-hidden="true"></span>{l.label}</a
                    >
                  {/snippet}
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
        {#if !own.length}<a
            class={pill}
            href={rt.url.home()}
            aria-current={path === rt.url.home() ? 'page' : undefined}>{rt.t('nav.all')}</a
          >{/if}
        {#if rt.url.search}<a
            class={pill}
            href={rt.url.search()}
            aria-current={path === rt.url.search() ? 'page' : undefined}
            ><SearchIcon class="size-4 opacity-70" aria-hidden="true" />{rt.t('search.title')}</a
          >{/if}
      </nav>
      <div class="ml-auto flex items-center gap-1 md:gap-2 lg:justify-self-end">
        {#if rt.url.search}<Button
            variant="ghost"
            size="icon"
            class="lg:hidden"
            href={rt.url.search()}
            aria-label={rt.t('search.label')}><SearchIcon /></Button
          >{/if}
        <LanguageMenu />
        {#if account}<a
            class="hidden rounded-full px-2 py-1 text-[0.9375rem] underline-offset-4 hover:underline md:inline"
            href={account}>{accountLabel}</a
          >{/if}
        <Button class={cn(btn, 'h-10 px-5')} href={rt.url.cart()} aria-label={cartLabel}>
          {rt.t('nav.cart')}{#if shop.cartCount}<span
              class="ln-mono grid h-5 min-w-5 place-items-center rounded-full bg-[var(--ln-signal)] px-1 text-xs text-[#202020]"
              >{shop.cartCount}</span
            >{/if}
        </Button>
        <Sheet.Root bind:open={menu}>
          <Sheet.Trigger
            class="grid size-10 place-items-center rounded-full outline-none hover:bg-[var(--ln-panel)] focus-visible:ring-3 focus-visible:ring-[var(--ln-accent)]/40 lg:hidden"
            aria-label={rt.t('nav.menu')}><MenuIcon class="size-5" /></Sheet.Trigger
          >
          <Sheet.Content side="right" class="gap-0 bg-[var(--ln-page)] p-0">
            <Sheet.Header class="px-6 pt-6"
              ><Sheet.Title class="ln-display text-3xl tracking-[-0.02em]">{rt.t('nav.menu')}</Sheet.Title
              ></Sheet.Header
            >
            <nav class="flex flex-col overflow-y-auto px-3 py-4" aria-label={rt.t('nav.categories')}>
              {#each own.length ? own : [{ href: rt.url.home(), label: rt.t('nav.all') }, ...cats] as l (l.href)}<a
                  class="ln-display flex items-center gap-3 rounded-xl px-3 py-2.5 text-xl tracking-[-0.01em] hover:bg-[var(--ln-panel)]"
                  href={l.href}
                  aria-current={path === l.href ? 'page' : undefined}
                  onclick={() => (menu = false)}
                  ><span class="ln-square size-2" aria-hidden="true"></span>{l.label}</a
                >{/each}
              {#if account}<a
                  class="mt-3 rounded-xl px-3 py-3 text-base font-medium hover:bg-[var(--ln-panel)]"
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
  {#if showDates}<div class={cn(wrap, 'mt-4 md:mt-6')}><DateBar /></div>{/if}
  <main id="main" class="flex-1">
    <div class={cn(wrap, 'py-8 md:py-14')}>{@render children()}</div>
  </main>
  <rt.components.Slot name="footer.before" />

  <footer class="mt-10 px-3 pb-3 md:mt-16 md:px-5 md:pb-5">
    <div class="relative overflow-hidden rounded-[20px] bg-[#202020] text-[#f5f5f5]">
      <svg
        class="pointer-events-none absolute top-10 right-6 hidden h-[calc(100%-5rem)] max-h-[440px] w-auto text-[var(--ln-signal)] md:block lg:right-10"
        viewBox="0 0 260 440"
        fill="currentColor"
        aria-hidden="true"
        ><path
          d="M140 0h112c-2 64-6 132-14 196-10 84-40 156-98 204-34 28-78 40-140 40V330c40 0 64-8 84-26 30-28 44-80 50-150 4-46 6-100 6-154Z"
        /></svg
      >
      <div class="relative grid gap-12 px-6 py-10 md:px-10 md:py-14 md:pr-[300px] lg:px-[60px] lg:pr-[340px]">
        <div class="flex flex-wrap items-center gap-x-8 gap-y-5">
          <a
            href={rt.url.home()}
            class="ln-display w-fit text-5xl leading-none tracking-[-0.03em] break-words md:text-6xl"
            >{shop.tenant.name}</a
          >
          <LanguageMenu variant="pills" />
        </div>
        <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          <nav class="flex flex-col gap-2.5" aria-labelledby="ln-footer-shop">
            <h2 id="ln-footer-shop" class="mb-2 text-base font-medium text-white">{rt.t('footer.shop')}</h2>
            <a class={footLink} href={rt.url.home()}>{rt.t('nav.all')}</a>
            {#each cats as l (l.href)}<a class={footLink} href={l.href}>{l.label}</a>{/each}
          </nav>
          <nav class="flex flex-col gap-2.5" aria-labelledby="ln-footer-info">
            <h2 id="ln-footer-info" class="mb-2 text-base font-medium text-white">{rt.t('footer.info')}</h2>
            <a class={footLink} href={rt.url.page('terms')}>{rt.t('footer.terms')}</a>
            {#each shop.navigation?.footer ?? [] as l (l.href)}<a class={footLink} href={l.href}>{l.label}</a
              >{/each}
            {#if rt.url.search}<a class={footLink} href={rt.url.search()}>{rt.t('search.title')}</a>{/if}
            {#if account}<a class={footLink} href={account}>{accountLabel}</a>{/if}
            <a class={footLink} href={rt.url.cart()}>{rt.t('nav.cart')}</a>
          </nav>
          {#if loc}
            <div class="flex flex-col gap-2.5">
              <h2 class="mb-2 text-base font-medium text-white">{rt.t('footer.visit')}</h2>
              <p class="text-[0.9375rem] leading-relaxed text-[#a8a8a8]">
                {loc.name}{#if loc.address?.line1}<br />{loc.address.line1}{/if}{#if loc.address?.city}<br
                  />{[loc.address.postal_code, loc.address.city].filter(Boolean).join(' ')}{/if}
              </p>
            </div>
          {/if}
        </div>
      </div>
      <div
        class="relative flex flex-wrap justify-between gap-2 border-t border-white/10 px-6 py-5 text-[0.8125rem] text-[#a8a8a8] md:px-10 lg:px-[60px]"
      >
        <span>{rt.t('footer.copyright', { year: new Date().getFullYear(), shop: shop.tenant.name })}</span>
        {#if shop.settings.show_powered_by !== false}<a
            class="hover:text-white hover:underline"
            href="https://openrent.dev"
            rel="noopener">{rt.t('footer.powered')}</a
          >{/if}
      </div>
    </div>
  </footer>
</div>
