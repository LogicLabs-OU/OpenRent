<script lang="ts">
  import { getRuntime, LOCALE_NAMES, type Locale } from '@openrent/theme-sdk';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { Button } from '@openrent/ui/button';
  import GlobeIcon from '@lucide/svelte/icons/globe';
  import CheckIcon from '@lucide/svelte/icons/check';

  /** Storefront languages, each named in its own words. Hidden when the shop offers one. */
  const rt = getRuntime();
  const locales = $derived(rt.shop.locales ?? []);
</script>

{#if locales.length > 1 && rt.url.switchLocale}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          data-testid="language-menu"
          class="h-full gap-2 rounded-none border-l border-black px-4 text-base font-normal hover:bg-(--retro-accent) hover:text-(--retro-accent-ink)"
          ><GlobeIcon class="size-5" /><span class="sr-only">{rt.t('nav.language')}: </span>{rt.shop.locale.toUpperCase()}</Button
        >
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="rounded-[0.25rem] shadow-[4px_4px_0_0_#000] ring-1 ring-black">
      {#each locales as l (l)}
        <DropdownMenu.Item>
          {#snippet child({ props })}
            <a
              {...props}
              href={rt.url.switchLocale!(l)}
              hreflang={l}
              lang={l}
              data-sveltekit-reload
              aria-current={l === rt.shop.locale ? 'true' : undefined}
            >
              <CheckIcon class={l === rt.shop.locale ? '' : 'invisible'} />{LOCALE_NAMES[l as Locale] ?? l}
            </a>
          {/snippet}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
