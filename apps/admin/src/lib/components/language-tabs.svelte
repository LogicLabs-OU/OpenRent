<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Tabs from '@openrent/ui/tabs';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { t } from '#lib';

  /**
   * One tab per storefront language for texts customers read. The first tab is the default language
   * (the base text); the others hold translations that fall back to it when empty.
   */
  let { locales, value = $bindable(), children }: { locales: string[]; value?: string; children: Snippet<[string, boolean]> } = $props();
  // svelte-ignore state_referenced_locally
  if (!value) value = locales[0];
</script>

{#if locales.length > 1}
  <Tabs.Root bind:value>
    <Tabs.List aria-label={t('language.label')}>
      {#each locales as l, i (l)}
        <Tabs.Trigger value={l} lang={l}>{LOCALE_NAMES[l as Locale] ?? l}{i === 0 ? ` · ${t('language.default')}` : ''}</Tabs.Trigger>
      {/each}
    </Tabs.List>
    {#each locales as l, i (l)}<Tabs.Content value={l}>{@render children(l, i === 0)}</Tabs.Content>{/each}
  </Tabs.Root>
{:else}
  {@render children(locales[0] ?? 'en', true)}
{/if}
