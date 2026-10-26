import { describe, expect, it } from 'vitest';
import { checkThemeSource, CHILD_THEME_FILE } from '../src/manifest.ts';

describe('theme source checks', () => {
  it('allows the theme toolkit and refuses server and network access', () => {
    const ok = `<script lang="ts">
  import { getRuntime } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import XIcon from '@lucide/svelte/icons/x';
  import { onMount } from 'svelte';
  import Hero from '../snippets/Hero.svelte';
  import data from './data.json';
</script>`;
    expect(checkThemeSource('templates/index.svelte', ok)).toEqual([]);
    const bad = `import { readFile } from 'node:fs';
import { goto } from '$app/navigation';
import { orders } from '@openrent/core';
const x = await import('child_process');
fetch('https://evil.example');`;
    const problems = checkThemeSource('layouts/theme.svelte', bad);
    expect(problems).toHaveLength(5);
    expect(problems[4]).toContain('network');
  });

  it('knows which files a child theme may carry', () => {
    for (const f of ['theme.json', 'theme.css', 'config/settings_data.json', 'locales/de.json', 'assets/img/hero.webp', 'assets/fonts/brand.woff2']) expect(CHILD_THEME_FILE.test(f)).toBe(true);
    for (const f of ['templates/index.svelte', 'index.ts', 'assets/x.js', 'config/settings_schema.json', '../theme.json']) expect(CHILD_THEME_FILE.test(f)).toBe(false);
  });
});
