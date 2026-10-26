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
        <Button {...props} variant="ghost" class="h-10 px-2 text-[1.0625rem] font-bold uppercase" data-testid="language-menu"
          ><GlobeIcon /><span class="sr-only"
            >{rt.t('nav.language')}:
          </span>{rt.shop.locale.toUpperCase()}</Button
        >
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="mq-font">
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
