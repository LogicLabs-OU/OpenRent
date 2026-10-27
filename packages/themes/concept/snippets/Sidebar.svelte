<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import HouseIcon from '@lucide/svelte/icons/house';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { categoryIcons, label, row } from '../lib/concept.ts';

  /** The left sidebar: the shop as a workspace, its pages, then the categories as a page tree. */
  let { path, onnavigate }: { path: string; onnavigate?: () => void } = $props();
  const rt = getRuntime();
  const shop = $derived(rt.shop);
  const icons = $derived(categoryIcons(shop.settings.category_icons));
  const item =
    'flex h-[30px] w-full items-center gap-2 px-2 text-sm text-[#5f5e5b] [&_svg]:size-[18px] [&_svg]:shrink-0';
  const on = 'bg-(--concept-hover) font-medium text-foreground';
  const account = $derived(
    shop.customer ? rt.url.account?.() : (rt.url.accountLogin?.() ?? rt.url.account?.()),
  );
</script>

<!-- Links close the mobile sheet when followed. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="flex h-full flex-col gap-4 px-2 py-2"
  onclick={(e) => (e.target as Element).closest('a') && onnavigate?.()}
>
  <a class={[row, 'flex h-11 items-center gap-2 px-2']} href={rt.url.home()}>
    {#if shop.tenant.branding.logo_url}
      <img class="size-6 rounded-[4px] object-contain" src={shop.tenant.branding.logo_url} alt="" />
    {:else}
      <span
        class="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-[4px] text-xs font-semibold"
        aria-hidden="true">{shop.tenant.name.slice(0, 1).toUpperCase()}</span
      >
    {/if}
    <span class="truncate text-sm font-semibold">{shop.tenant.name}</span>
  </a>

  <nav class="flex flex-col gap-px" aria-label={rt.t('nav.menu')}>
    {#if rt.url.search}
      <a
        class={[row, item, path.startsWith(rt.url.search()) && on]}
        href={rt.url.search()}
        aria-current={path.startsWith(rt.url.search()) ? 'page' : undefined}
        ><SearchIcon />{rt.t('search.title')}</a
      >
    {/if}
    <a
      class={[row, item, path === rt.url.home() && on]}
      href={rt.url.home()}
      aria-current={path === rt.url.home() ? 'page' : undefined}><HouseIcon />{rt.t('nav.home')}</a
    >
    <a
      class={[row, item, path.startsWith(rt.url.cart()) && on]}
      href={rt.url.cart()}
      aria-current={path.startsWith(rt.url.cart()) ? 'page' : undefined}
    >
      <ShoppingCartIcon />{rt.t('nav.cart')}
      {#if shop.cartCount}<span class="text-muted-foreground ml-auto text-xs tabular-nums"
          >{shop.cartCount}</span
        >{/if}
    </a>
    {#if account}
      <a
        class={[row, item, path.startsWith(account) && on]}
        href={account}
        aria-current={path.startsWith(account) ? 'page' : undefined}
        ><UserRoundIcon />{shop.customer ? rt.t('nav.account') : rt.t('nav.sign_in')}</a
      >
    {/if}
  </nav>

  <!-- The shop's own header menu (theme API 1.9); the sidebar keeps the categories below it. -->
  {#if shop.navigation?.header.length}
    <nav class="flex flex-col gap-px" aria-label={rt.t('nav.menu')}>
      {#each shop.navigation.header as l (l.href)}
        <a
          class={[row, item, path === l.href && on]}
          href={l.href}
          aria-current={path === l.href ? 'page' : undefined}
          ><FileTextIcon /><span class="truncate">{l.label}</span></a
        >
      {/each}
    </nav>
  {/if}

  {#if shop.categories.length}
    <nav class="flex flex-col gap-px" aria-labelledby="concept-categories">
      <h2 id="concept-categories" class={[label, 'px-2 pb-1']}>{rt.t('nav.categories')}</h2>
      {#each shop.categories as c (c.id)}
        {@const href = rt.url.category(c.slug)}
        <a class={[row, item, path === href && on]} {href} aria-current={path === href ? 'page' : undefined}>
          {#if icons[c.slug]}<span class="w-[18px] text-center leading-none" aria-hidden="true"
              >{icons[c.slug]}</span
            >{:else}<FileTextIcon />{/if}
          <span class="truncate">{c.name}</span>
        </a>
      {/each}
    </nav>
  {/if}

  <div class="text-muted-foreground mt-auto flex flex-col gap-px pb-1 text-xs">
    <a class={[row, 'px-2 py-1']} href={rt.url.page('terms')}>{rt.t('footer.terms')}</a>
    {#each shop.navigation?.footer ?? [] as l (l.href)}<a class={[row, 'px-2 py-1']} href={l.href}
        >{l.label}</a
      >{/each}
    {#if shop.settings.show_powered_by !== false}<a
        class={[row, 'px-2 py-1']}
        href="https://openrent.dev"
        rel="noopener">{rt.t('footer.powered')}</a
      >{/if}
  </div>
</div>
