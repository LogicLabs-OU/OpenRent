<script lang="ts">
  import { page } from '$app/state';

  /** The page's title and description for search engines and shared links; `noindex` keeps it out of search results. */
  let { title, description = null, image = null, noindex = false }: { title: string; description?: string | null; image?: string | null; noindex?: boolean } = $props();
  const canonical = $derived(page.url.origin + page.url.pathname);
</script>

<svelte:head>
  <title>{title}</title>
  {#if noindex}
    <meta name="robots" content="noindex" />
  {:else}
    <link rel="canonical" href={canonical} />
    {#if description}<meta name="description" content={description} />{/if}
    <meta property="og:title" content={title} />
    <meta property="og:url" content={canonical} />
    {#if description}<meta property="og:description" content={description} />{/if}
    {#if image}<meta property="og:image" content={image} />{/if}
    <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
  {/if}
</svelte:head>
