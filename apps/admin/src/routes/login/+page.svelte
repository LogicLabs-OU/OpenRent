<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { api, ApiError, session, t, fieldErrors } from '#lib';
  import { to } from '#lib/nav.ts';

  let email = $state('');
  let password = $state('');
  let totp = $state('');
  let needTotp = $state(false);
  let error = $state('');
  let errors = $state<Record<string, string>>({});
  let info = $state('');
  let busy = $state(false);
  // Single sign-on (FR-USR-4): providers that vouch for the email's domain offer a button.
  let providers = $state<{ id: string; name: string; tenant_name: string }[]>([]);
  let lookup: ReturnType<typeof setTimeout> | undefined;
  const SSO_ERRORS = ['sso_required', 'sso_email_unverified', 'sso_domain_not_allowed', 'sso_user_disabled', 'sso_unknown_provider'];

  function findProviders() {
    clearTimeout(lookup);
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return void (providers = []);
    lookup = setTimeout(async () => {
      providers = (await api.get(`/auth/sso?email=${encodeURIComponent(e)}`).catch(() => ({ data: [] }))).data;
    }, 300);
  }
  /** Where the provider sends the person back to, inside the admin. */
  const ssoStart = (id: string) => `/api/v1/auth/oidc/${id}/start?next=${encodeURIComponent(next().replace(/^\/admin/, '') || '/')}`;

  const next = () => {
    const n = page.url.searchParams.get('next');
    return n && n.startsWith('/admin') ? n : to('/');
  };

  onMount(async () => {
    const ssoError = page.url.searchParams.get('sso_error');
    if (ssoError) error = SSO_ERRORS.includes(ssoError) ? t(`login.${ssoError}` as any) : t('login.sso_failed');
    const magic = page.url.searchParams.get('magic');
    if (magic) {
      try {
        await api.post('/auth/magic_link/verify', { token: magic });
        await session.load();
        goto(next());
      } catch (e) {
        error = (e as Error).message;
      }
      return;
    }
    const s = await api.get('/setup').catch(() => null);
    if (s?.required) goto(to('/setup'));
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    errors = {};
    try {
      await api.post('/auth/login', { email, password, ...(needTotp ? { totp } : {}) });
      await session.load();
      goto(next());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') needTotp = true;
      else if (err instanceof ApiError && err.code === 'sso_required') error = t('login.sso_required');
      else {
        errors = fieldErrors(err);
        error = (err as Error).message;
      }
    } finally {
      busy = false;
    }
  }

  async function magicLink() {
    if (!email) {
      errors = { email: t('login.email_first') };
      return;
    }
    await api.post('/auth/magic_link', { email }).catch(() => undefined);
    info = t('login.magic_sent');
  }
</script>

<svelte:head><title>{t('login.title')} · OpenRent</title></svelte:head>

<div class="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
  <div class="w-full max-w-sm">
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-xl">{t('login.title')}</Card.Title>
        <Card.Description>{t('login.subtitle')}</Card.Description>
      </Card.Header>
      <Card.Content>
        <form onsubmit={submit}>
          <Field.Group>
            {#if error}
              <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{error}</Alert.Title></Alert.Root>
            {/if}
            {#if info}<Alert.Root><Alert.Title>{info}</Alert.Title></Alert.Root>{/if}
            <Field.Field data-invalid={!!errors.email || undefined}>
              <Field.Label for="email">{t('field.email')}</Field.Label>
              <Input id="email" type="email" autocomplete="username" required bind:value={email} oninput={findProviders} aria-invalid={!!errors.email || undefined} />
              {#if errors.email}<Field.Error>{errors.email}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.password || undefined}>
              <Field.Label for="password">{t('field.password')}</Field.Label>
              <Input id="password" type="password" autocomplete="current-password" required bind:value={password} aria-invalid={!!errors.password || undefined} />
              {#if errors.password}<Field.Error>{errors.password}</Field.Error>{/if}
            </Field.Field>
            {#if needTotp}
              <Field.Field>
                <Field.Label for="totp">{t('login.totp')}</Field.Label>
                <Input id="totp" inputmode="numeric" autocomplete="one-time-code" required bind:value={totp} />
                <Field.Description>{t('login.totp_hint')}</Field.Description>
              </Field.Field>
            {/if}
            {#each providers as p (p.id)}
              <Button variant="outline" href={ssoStart(p.id)} data-testid="sso-button">{t('login.sso_with', { name: p.name })}</Button>
            {/each}
            <Field.Field>
              <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('login.submit')}</Button>
              <Button type="button" variant="link" onclick={magicLink}>{t('login.magic')}</Button>
            </Field.Field>
          </Field.Group>
        </form>
      </Card.Content>
    </Card.Root>
  </div>
</div>
