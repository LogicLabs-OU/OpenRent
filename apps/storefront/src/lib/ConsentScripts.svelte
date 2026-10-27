<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@openrent/ui/button';
  import { t } from './i18n/index.ts';
  import { allowAnalytics } from './analytics.ts';

  /**
   * Plugins' storefront scripts (FR-PLG-5). "Necessary" ones load at once; analytics and marketing ones
   * only after the visitor agrees, and the choice is kept for a year. Analytics events wait for the same consent.
   */
  type Script = { plugin: string; src: string; consent: 'necessary' | 'analytics' | 'marketing'; attrs?: Record<string, string> };
  let { scripts, locale }: { scripts: Script[]; locale: string } = $props();
  const COOKIE = 'or_consent';
  let choice = $state<string | null>(null);
  const optional = $derived(scripts.some((s) => s.consent !== 'necessary'));

  function load(allowed: Set<string>) {
    // Analytics events (FR-SF-8) flow only once the visitor allows them; vendor queues are set up first.
    if (allowed.has('analytics')) allowAnalytics(scripts.filter((s) => allowed.has(s.consent)));
    for (const s of scripts) {
      if (!allowed.has(s.consent) || document.querySelector(`script[data-or-plugin][src="${CSS.escape(s.src)}"]`)) continue;
      const el = document.createElement('script');
      el.src = s.src;
      el.async = true;
      el.dataset.orPlugin = s.plugin;
      for (const [k, v] of Object.entries(s.attrs ?? {})) el.setAttribute(k, v);
      document.head.appendChild(el);
    }
  }

  function decide(value: 'all' | 'necessary') {
    document.cookie = `${COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    choice = value;
    load(new Set(value === 'all' ? ['necessary', 'analytics', 'marketing'] : ['necessary']));
  }

  onMount(() => {
    choice = document.cookie.match(/(?:^|; )or_consent=(all|necessary)/)?.[1] ?? null;
    load(new Set(choice === 'all' ? ['necessary', 'analytics', 'marketing'] : ['necessary']));
  });
</script>

{#if optional && choice === null}
  <div class="bg-background fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-lg border p-4 text-sm shadow-lg sm:flex-row sm:items-center" role="dialog" aria-label={t('consent.title', {}, locale)} data-testid="consent">
    <p class="flex-1">{t('consent.text', {}, locale)}</p>
    <div class="flex gap-2">
      <Button size="sm" variant="outline" onclick={() => decide('necessary')}>{t('consent.necessary', {}, locale)}</Button>
      <Button size="sm" onclick={() => decide('all')}>{t('consent.all', {}, locale)}</Button>
    </div>
  </div>
{/if}
