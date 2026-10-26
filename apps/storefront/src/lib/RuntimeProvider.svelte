<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { provideRuntime, type Shop, type ThemeModule } from '@openrent/theme-sdk';
  import { createRuntime } from './runtime.ts';

  /** Gives a theme its runtime for one language; the layout re-creates it when the language changes. */
  let { theme, getShop, overrides, children }: { theme: ThemeModule; getShop: () => Shop; overrides: Record<string, Record<string, string>>; children: Snippet } = $props();
  // svelte-ignore state_referenced_locally
  provideRuntime(createRuntime(theme, getShop, overrides, () => page.url.pathname + page.url.search));
</script>

{@render children()}
