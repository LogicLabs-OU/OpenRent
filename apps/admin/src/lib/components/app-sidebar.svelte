<script lang="ts">
  import PluginSlot from './plugin-slot.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import * as Sidebar from '@openrent/ui/sidebar';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import * as Avatar from '@openrent/ui/avatar';
  import { setMode, userPrefersMode } from 'mode-watcher';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import SunMoonIcon from '@lucide/svelte/icons/sun-moon';
  import LanguagesIcon from '@lucide/svelte/icons/languages';
  import { LOCALES, LOCALE_NAMES } from '@openrent/i18n';
  import { api, session, t, getLocale, notifyError } from '#lib';
  import { NAV, NAV_CONFIGURE, to } from '#lib/nav.ts';

  const isActive = (href: string) => {
    const p = page.url.pathname.replace(/^\/admin/, '') || '/';
    return href === '/' ? p === '/' : p.startsWith(href);
  };
  const initials = $derived(
    (session.me?.user.name || session.me?.user.email || '?')
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join(''),
  );

  async function signOut() {
    await api.post('/auth/logout').catch(() => undefined);
    session.me = null;
    goto(to('/login'));
  }
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg">
          {#snippet child({ props })}
            <a href={to('/')} {...props}>
              <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                {session.me?.tenant?.name?.[0] ?? 'O'}
              </div>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-medium">{session.me?.tenant?.name}</span>
                <span class="truncate text-xs text-muted-foreground">OpenRent</span>
              </div>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>
  <Sidebar.Content>
    {#each [{ label: t('nav.group.operations'), items: NAV }, { label: t('nav.group.configure'), items: NAV_CONFIGURE }] as group (group.label)}
      <Sidebar.Group>
        <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            {#each group.items.filter((i) => !i.perm || session.can(i.perm)) as item (item.href)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton isActive={isActive(item.href)} tooltipContent={t(item.key)}>
                  {#snippet child({ props })}
                    <a href={to(item.href)} {...props}>
                      <item.icon />
                      <span>{t(item.key)}</span>
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    {/each}
    <Sidebar.Group class="mt-auto">
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton size="sm" tooltipContent={t('nav.api_docs')}>
              {#snippet child({ props })}
                <a href="/docs" target="_blank" rel="noopener" {...props}><BookOpenIcon /><span>{t('nav.api_docs')}</span></a>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
    <div class="px-2"><PluginSlot slot="nav.item" /></div>
  </Sidebar.Content>
  <Sidebar.Footer>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuButton size="lg" class="data-[state=open]:bg-sidebar-accent" {...props}>
                <Avatar.Root class="size-8 rounded-lg"><Avatar.Fallback class="rounded-lg">{initials}</Avatar.Fallback></Avatar.Root>
                <div class="grid flex-1 text-left text-sm leading-tight">
                  <span class="truncate font-medium">{session.me?.user.name || session.me?.user.email}</span>
                  <span class="truncate text-xs text-muted-foreground">{session.me?.role ? t(`role.${session.me.role}` as any) : ''}</span>
                </div>
                <ChevronsUpDownIcon class="ml-auto size-4" />
              </Sidebar.MenuButton>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width) min-w-56" side="top" align="end">
            <DropdownMenu.Label class="font-normal">
              <div class="text-sm font-medium">{session.me?.user.name}</div>
              <div class="text-xs text-muted-foreground">{session.me?.user.email}</div>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger><SunMoonIcon />{t('theme.label')}</DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent>
                <DropdownMenu.RadioGroup value={userPrefersMode.current} onValueChange={(v) => setMode(v as 'light' | 'dark' | 'system')}>
                  <DropdownMenu.RadioItem value="light">{t('theme.light')}</DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="dark">{t('theme.dark')}</DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="system">{t('theme.system')}</DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger data-testid="admin-language"><LanguagesIcon />{t('language.label')}</DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent>
                <DropdownMenu.RadioGroup value={getLocale()} onValueChange={(v) => session.setLanguage(v).catch(notifyError)}>
                  {#each LOCALES as l (l)}<DropdownMenu.RadioItem value={l} lang={l}>{LOCALE_NAMES[l]}</DropdownMenu.RadioItem>{/each}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={signOut}><LogOutIcon />{t('action.sign_out')}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>
