<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import * as Alert from '@openrent/ui/alert';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { api, session, t, notifyError } from '#lib';
  import { to } from '#lib/nav.ts';

  /**
   * Consent for a third-party app (OAuth 2.1, PRD §5.2): the app, where it sends the person back, and what
   * it may do in this shop. Only people who may manage API keys can approve; the app gets at most what
   * they themselves may do.
   */
  let request = $state<any>(null);
  let busy = $state(false);
  const params = () => Object.fromEntries(page.url.searchParams);

  onMount(async () => {
    await session.load();
    if (!session.me) return goto(to(`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`));
    if (!session.can('api_keys:manage')) {
      request = { ok: false, problem: t('oauth.no_right') };
      return;
    }
    try {
      request = await api.post('/oauth/authorize/check', params());
      // A request the app got wrong goes back to it, as OAuth says.
      if (request.redirect_to) location.href = request.redirect_to;
    } catch (e) {
      notifyError(e);
    }
  });

  async function decide(allow: boolean) {
    busy = true;
    try {
      const r = await api.post(allow ? '/oauth/authorize/approve' : '/oauth/authorize/deny', params());
      location.href = r.redirect_to;
    } catch (e) {
      busy = false;
      notifyError(e);
    }
  }
</script>

<svelte:head><title>{t('oauth.title')} · OpenRent</title></svelte:head>

<div class="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
  <div class="w-full max-w-md">
    <Card.Root data-testid="oauth-consent">
      {#if !request}
        <Card.Content class="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t('common.loading')}</Card.Content>
      {:else if !request.ok && request.problem}
        <Card.Header><Card.Title><h1 class="text-xl">{t('oauth.title')}</h1></Card.Title></Card.Header>
        <Card.Content>
          <Alert.Root variant="destructive"><TriangleAlertIcon /><Alert.Title>{t('oauth.refused')}</Alert.Title><Alert.Description>{request.problem}</Alert.Description></Alert.Root>
        </Card.Content>
        <Card.Footer><Button variant="outline" href={to('/')}>{t('oauth.back')}</Button></Card.Footer>
      {:else if request.ok}
        <Card.Header>
          <Card.Title><h1 class="text-xl">{t('oauth.ask', { app: request.app.name, shop: session.me?.tenant?.name ?? '' })}</h1></Card.Title>
          <Card.Description>{t('oauth.ask_hint', { host: request.app.redirect_host })}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          <div>
            <p class="mb-2 text-sm font-medium">{t('oauth.it_may')}</p>
            <ul class="flex flex-col gap-1 text-sm" data-testid="oauth-scopes">
              {#each request.scopes as s (s)}
                <li class="flex items-center gap-2"><ShieldCheckIcon class="size-4 text-muted-foreground" aria-hidden="true" />{t(`permission.${s.split(':')[0]}` as any)}: {t(`permission.${s.replace(':', '.')}` as any).toLowerCase()}</li>
              {/each}
            </ul>
          </div>
          <p class="text-muted-foreground text-sm">{t('oauth.later')}</p>
          {#if request.app.homepage}<a class="text-sm underline" href={request.app.homepage} rel="noopener noreferrer" target="_blank">{request.app.homepage}</a>{/if}
        </Card.Content>
        <Card.Footer class="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onclick={() => decide(false)}>{t('oauth.deny')}</Button>
          <Button disabled={busy} onclick={() => decide(true)}>{#if busy}<Spinner />{/if}{t('oauth.allow')}</Button>
        </Card.Footer>
      {:else}
        <Card.Content class="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t('oauth.returning')}</Card.Content>
      {/if}
    </Card.Root>
  </div>
</div>
