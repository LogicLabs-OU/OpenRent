<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Toaster } from '@openrent/ui/sonner';
  import { toast } from 'svelte-sonner';
  import { Button } from '@openrent/ui/button';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import RuntimeProvider from '#lib/RuntimeProvider.svelte';
  import { switchLocalePath } from '#lib/runtime.ts';
  import { themeFor } from '#lib/themes.ts';
  import { t } from '#lib/i18n/index.ts';
  import ShopCss from '#lib/ShopCss.svelte';
  import ConsentScripts from '#lib/ConsentScripts.svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
  // svelte-ignore state_referenced_locally
  const theme = themeFor(data.themeId);
  const Layout = theme.layout;
  // Marks the page interactive (used by end-to-end tests and analytics hooks).
  onMount(() => document.body.setAttribute('data-hydrated', '1'));
  // A short message after a link from an email (?notice=), in every theme; the address is cleaned after.
  const NOTICES = { cart_restored: 'notice.cart_restored', cart_restored_pick_dates: 'notice.cart_restored_pick_dates', reminders_stopped: 'notice.reminders_stopped', cart_link_expired: 'notice.cart_link_expired' } as const;
  onMount(() => {
    const key = page.url.searchParams.get('notice') as keyof typeof NOTICES | null;
    if (!key || !(key in NOTICES)) return;
    (key === 'cart_link_expired' ? toast.info : toast.success)(t(NOTICES[key], {}, data.shop.locale));
    const u = new URL(location.href);
    u.searchParams.delete('notice');
    history.replaceState(history.state, '', u);
  });
</script>

<svelte:head>
  <title>{data.shop.tenant.name}</title>
  <meta name="description" content={t('meta.description', { shop: data.shop.tenant.name }, data.shop.locale)} />
  {#if (data.shop.locales?.length ?? 0) > 1}
    <!-- Every language version of this page, for search engines. -->
    {#each data.shop.locales ?? [] as l (l)}<link rel="alternate" hreflang={l} href={page.url.origin + switchLocalePath(l, data.shop.locales![0]!, page.url.pathname)} />{/each}
    <link rel="alternate" hreflang="x-default" href={page.url.origin + switchLocalePath(data.shop.locales![0]!, data.shop.locales![0]!, page.url.pathname)} />
  {/if}
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230891b2'/%3E%3C/svg%3E" />
</svelte:head>

{#if data.preview}
  <!-- Fixed colours: the banner must stay readable whatever the previewed theme does with its tokens.
       It scrolls with the page, so it never covers a theme's sticky header. -->
  <div class="relative z-50 flex bg-[#18181b] text-white flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-sm" role="status">
    <span class="flex items-center gap-2"><EyeIcon class="size-4" />{t('preview.banner', { theme: data.preview }, data.shop.locale)}</span>
    <Button size="sm" class="bg-white text-[#18181b] hover:bg-white/90" href="/_or/preview" data-sveltekit-reload>{t('preview.exit', {}, data.shop.locale)}</Button>
  </div>
{/if}
{#key data.shop.locale}
  <RuntimeProvider {theme} getShop={() => data.shop} overrides={data.themeOverrides}>
    <Layout path={page.url.pathname}>{@render children()}</Layout>
  </RuntimeProvider>
{/key}
{#if data.themeCss}<ShopCss css={data.themeCss} />{/if}
<ShopCss css={data.code.css} />
{#if data.extensions?.scripts?.length}<ConsentScripts scripts={data.extensions.scripts} locale={data.shop.locale} />{/if}
<Toaster richColors position="top-center" />
