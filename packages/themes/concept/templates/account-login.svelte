<script lang="ts">
  import { getRuntime, RuntimeError, type AccountLoginData } from '@openrent/theme-sdk';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import MailCheckIcon from '@lucide/svelte/icons/mail-check';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { toast } from 'svelte-sonner';

  let { data }: { data: AccountLoginData } = $props();
  const rt = getRuntime();
  // svelte-ignore state_referenced_locally
  let view = $state(data.state);
  let email = $state('');
  let error = $state('');
  let failed = $state('');
  let busy = $state(false);

  async function request(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await rt.account!.login(email);
      view = 'sent';
    } catch (err) {
      if (err instanceof RuntimeError && err.fields.email) error = err.fields.email;
      else toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function verify() {
    busy = true;
    failed = '';
    try {
      await rt.account!.verify(data.token ?? '');
      location.assign(rt.url.account?.() ?? '/account');
    } catch (err) {
      failed = (err as Error).message;
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-sm flex-col gap-5 px-5 pt-16">
  <div class="text-[3.5rem] leading-none select-none" aria-hidden="true">{view === 'sent' ? '📬' : '🔑'}</div>
  <Card.Root class="gap-5 bg-transparent [--card-spacing:0]" style="box-shadow:none">
    {#if view === 'verify'}
      <Card.Header>
        <Card.Title class="text-2xl">{rt.t('login.verify_title')}</Card.Title>
        <Card.Description>{rt.t('login.verify_hint')}</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#if failed}
          <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{failed}</Alert.Title></Alert.Root
          >
          <Button variant="outline" href={rt.url.accountLogin?.() ?? '/account/login'}
            >{rt.t('login.new_link')}</Button
          >
        {:else}
          <Button size="lg" onclick={verify} disabled={busy || !data.token}
            >{#if busy}<Spinner />{/if}{rt.t('login.verify')}</Button
          >
        {/if}
      </Card.Content>
    {:else if view === 'sent'}
      <Card.Header>
        <Card.Title class="flex items-center gap-2 text-2xl"
          ><MailCheckIcon class="size-6" />{rt.t('login.sent_title')}</Card.Title
        >
        <Card.Description role="status">{rt.t('login.sent_hint', { email })}</Card.Description>
      </Card.Header>
      <Card.Footer
        ><Button variant="outline" onclick={() => (view = 'form')}>{rt.t('login.other_email')}</Button
        ></Card.Footer
      >
    {:else}
      <Card.Header>
        <Card.Title class="text-2xl">{rt.t('login.title')}</Card.Title>
        <Card.Description>{rt.t('login.hint')}</Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="flex flex-col gap-4" onsubmit={request} novalidate>
          <Field.Field data-invalid={!!error || undefined}>
            <Field.Label for="or-login-email">{rt.t('checkout.email')}</Field.Label>
            <Input
              id="or-login-email"
              type="email"
              autocomplete="email"
              required
              bind:value={email}
              aria-invalid={!!error}
            />
            {#if error}<Field.Error>{error}</Field.Error>{/if}
          </Field.Field>
          <Button type="submit" size="lg" disabled={busy}
            >{#if busy}<Spinner />{/if}{rt.t('login.send')}</Button
          >
        </form>
      </Card.Content>
    {/if}
  </Card.Root>
</div>
