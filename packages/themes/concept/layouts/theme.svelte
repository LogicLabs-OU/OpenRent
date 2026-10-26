<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getRuntime } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Breadcrumb from '@openrent/ui/breadcrumb';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import XIcon from '@lucide/svelte/icons/x';
  import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
  import DateBar from '../snippets/DateBar.svelte';
  import LanguageMenu from '../snippets/LanguageMenu.svelte';
  import Sidebar from '../snippets/Sidebar.svelte';
  import { col, conceptCss } from '../lib/concept.ts';

  /** An app shell: a quiet sidebar with the shop's pages, a slim top bar with the path, and the page. */
  let { children, path }: { children: Snippet; path: string } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const css = $derived(conceptCss(shop.settings.accent, shop.settings.full_width === true));
  const loc = $derived(shop.locations[0]);
  // `path` includes the language prefix (/de/...), so compare with the runtime's URLs.
  const showDates = $derived(!path.startsWith(rt.url.order('')) && !path.startsWith(rt.url.checkout()));
  let menu = $state(false);

  /** Where the visitor is, for the breadcrumb (product names are not known here, so products stop at the shop). */
  const here = $derived.by(() => {
    if (path === rt.url.home()) return '';
    const c = shop.categories.find((x) => path === rt.url.category(x.slug));
    if (c) return c.name;
    if (path.startsWith(rt.url.cart())) return rt.t('nav.cart');
    if (path.startsWith(rt.url.checkout())) return rt.t('checkout.title');
    if (rt.url.search && path.startsWith(rt.url.search())) return rt.t('search.title');
    if (rt.url.account && path.startsWith(rt.url.account()))
      return shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in');
    return '';
  });
</script>

<svelte:head>
  {@html `<style>${css}</style>`}
</svelte:head>

<div class="bg-background text-foreground flex min-h-svh">
  <a
    class="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
    href="#main">{rt.t('a11y.skip')}</a
  >
  <aside
    class="sticky top-0 hidden h-svh w-60 shrink-0 overflow-y-auto border-r border-[#efeeec] bg-(--concept-wash) md:block"
  >
    <Sidebar {path} />
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <header
      class="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-11 items-center gap-1 px-2 backdrop-blur sm:px-3"
    >
      <Sheet.Root bind:open={menu}>
        <Sheet.Trigger
          class="hover:bg-(--concept-hover) grid size-8 place-items-center rounded-[4px] md:hidden"
          aria-label={rt.t('nav.menu')}
        >
          <MenuIcon class="size-[18px]" />
        </Sheet.Trigger>
        <Sheet.Content side="left" class="w-64 gap-0 bg-(--concept-wash) p-0" showCloseButton={false}>
          <Sheet.Header class="sr-only"><Sheet.Title>{rt.t('nav.menu')}</Sheet.Title></Sheet.Header>
          <Sheet.Close
            class="hover:bg-(--concept-hover) absolute top-3 right-2 z-10 grid size-7 place-items-center rounded-[4px]"
            aria-label={rt.t('nav.close')}><XIcon class="size-4" /></Sheet.Close
          >
          <Sidebar {path} onnavigate={() => (menu = false)} />
        </Sheet.Content>
      </Sheet.Root>
      <Breadcrumb.Root class="min-w-0 flex-1 px-1" aria-label={rt.t('nav.breadcrumb')}>
        <Breadcrumb.List class="flex-nowrap text-sm">
          <Breadcrumb.Item class="min-w-0">
            {#if here}<Breadcrumb.Link class="truncate" href={rt.url.home()}
                >{shop.tenant.name}</Breadcrumb.Link
              >{:else}<Breadcrumb.Page class="truncate">{shop.tenant.name}</Breadcrumb.Page>{/if}
          </Breadcrumb.Item>
          {#if here}
            <Breadcrumb.Separator>/</Breadcrumb.Separator>
            <Breadcrumb.Item class="min-w-0"
              ><Breadcrumb.Page class="truncate">{here}</Breadcrumb.Page></Breadcrumb.Item
            >
          {/if}
        </Breadcrumb.List>
      </Breadcrumb.Root>
      <LanguageMenu />
      <Button
        variant="ghost"
        size="sm"
        href={rt.url.cart()}
        aria-label={shop.cartCount ? `${rt.t('nav.cart')} (${shop.cartCount})` : rt.t('nav.cart')}
      >
        <ShoppingCartIcon />
        <span class="hidden sm:inline">{rt.t('nav.cart')}</span>
        {#if shop.cartCount}<span
            class="bg-primary text-primary-foreground grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] tabular-nums"
            >{shop.cartCount}</span
          >{/if}
      </Button>
    </header>
    <rt.components.Slot name="header.after" />
    {#if showDates}<DateBar />{/if}
    <main id="main" class="flex-1 pb-24">{@render children()}</main>
    <rt.components.Slot name="footer.before" />
    <footer class="text-muted-foreground border-t border-[#efeeec] py-5 text-xs">
      <div class={col}>
        {shop.tenant.name}{#if loc}{' · '}{loc.name}{loc.address?.line1 ? `, ${loc.address.line1}` : ''}{loc
            .address?.city
            ? `, ${loc.address.city}`
            : ''}{/if}
      </div>
    </footer>
  </div>
</div>
