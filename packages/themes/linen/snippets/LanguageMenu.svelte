<script lang="ts">
  import { getRuntime, LOCALE_NAMES, type Locale } from '@openrent/theme-sdk';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import CheckIcon from '@lucide/svelte/icons/check';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

  /**
   * Storefront languages. `text` is the header's small-caps code with a menu; `pills` is the footer's toggle with
   * every language as a link. Hidden when the shop offers one language.
   */
  let { variant = 'text' }: { variant?: 'text' | 'pills' } = $props();
  const rt = getRuntime();
  const locales = $derived(rt.shop.locales ?? []);
</script>

{#if locales.length > 1 && rt.url.switchLocale}
  {#if variant === 'pills'}
    <nav aria-label={rt.t('nav.language')}>
      <ul class="inline-flex flex-wrap rounded-full bg-[#3a3a3a] p-1">
        {#each locales as l (l)}
          {@const on = l === rt.shop.locale}
          <li>
            <a
              class={[
                'grid h-8 min-w-11 place-items-center rounded-full px-3 text-[0.8125rem] font-medium uppercase transition-colors',
                on ? 'bg-[#f5f5f5] text-[#202020]' : 'text-[#d9c9a3] hover:text-white',
              ]}
              href={rt.url.switchLocale!(l)}
              hreflang={l}
              lang={l}
              title={LOCALE_NAMES[l as Locale] ?? l}
              data-sveltekit-reload
              aria-current={on ? 'true' : undefined}>{l}</a
            >
          </li>
        {/each}
      </ul>
    </nav>
  {:else}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="hover:text-foreground flex h-9 items-center gap-1 rounded-full px-2 text-[0.8125rem] font-medium text-[#202020] uppercase outline-none focus-visible:ring-3 focus-visible:ring-[var(--ln-accent)]/40"
        data-testid="language-menu"
        ><span class="sr-only">{rt.t('nav.language')}: </span>{rt.shop.locale.toUpperCase()}<ChevronDownIcon
          class="size-3.5 opacity-60"
          aria-hidden="true"
        /></DropdownMenu.Trigger
      >
      <DropdownMenu.Content align="end" class="min-w-44 p-1.5">
        {#each locales as l (l)}
          <DropdownMenu.Item class="rounded-lg">
            {#snippet child({ props })}
              <a
                {...props}
                href={rt.url.switchLocale!(l)}
                hreflang={l}
                lang={l}
                data-sveltekit-reload
                aria-current={l === rt.shop.locale ? 'true' : undefined}
              >
                <CheckIcon class={l === rt.shop.locale ? 'text-[var(--ln-accent)]' : 'invisible'} />{LOCALE_NAMES[
                  l as Locale
                ] ?? l}
              </a>
            {/snippet}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
{/if}
