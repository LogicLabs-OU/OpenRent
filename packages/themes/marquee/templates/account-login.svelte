<script lang="ts">
  import { getRuntime, RuntimeError, type AccountLoginData } from '@openrent/theme-sdk';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import MailCheckIcon from '@lucide/svelte/icons/mail-check';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { toast } from 'svelte-sonner';
  import { box, cta, ghost, h2 } from '../lib/marquee.ts';

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

<div class="mx-auto flex max-w-xl flex-col gap-6 py-4 md:py-10">
  <section class={[box, 'mq-crop relative bg-white']}>
    {#if view === 'verify'}
      <div class="flex flex-col gap-4 p-6 md:p-8">
        <h1 class={h2}>{rt.t('login.verify_title')}</h1>
        <p class="text-lg leading-snug uppercase">{rt.t('login.verify_hint')}</p>
        {#if failed}
          <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{failed}</Alert.Title></Alert.Root>
          <Button variant="outline" class={ghost} href={rt.url.accountLogin?.() ?? '/account/login'}
            >{rt.t('login.new_link')}</Button
          >
        {/if}
      </div>
      {#if !failed}<Button class={[cta, 'w-full justify-between border-t border-(--mq-ink)']} onclick={verify} disabled={busy || !data.token}
          >{rt.t('login.verify')}{#if busy}<Spinner />{:else}<ArrowRightIcon class="mq-arrow" />{/if}</Button
        >{/if}
    {:else if view === 'sent'}
      <div class="flex flex-col gap-4 p-6 md:p-8">
        <MailCheckIcon class="size-10 text-(--mq-accent)" aria-hidden="true" />
        <h1 class={h2}>{rt.t('login.sent_title')}</h1>
        <p class="text-lg leading-snug uppercase" role="status">{rt.t('login.sent_hint', { email })}</p>
        <Button variant="outline" class={[ghost, 'w-fit']} onclick={() => (view = 'form')}>{rt.t('login.other_email')}</Button>
      </div>
    {:else}
      <form class="flex flex-col" onsubmit={request} novalidate>
        <div class="flex flex-col gap-5 p-6 md:p-8">
          <h1 class={h2}>{rt.t('login.title')}</h1>
          <p class="text-lg leading-snug uppercase">{rt.t('login.hint')}</p>
          <Field.Field data-invalid={!!error || undefined}>
            <Field.Label for="or-login-email">{rt.t('checkout.email')}</Field.Label>
            <Input
              id="or-login-email"
              type="email"
              autocomplete="email"
              required
              class="h-12 text-lg"
              bind:value={email}
              aria-invalid={!!error}
            />
            {#if error}<Field.Error>{error}</Field.Error>{/if}
          </Field.Field>
        </div>
        <Button type="submit" class={[cta, 'w-full justify-between border-t border-(--mq-ink)']} disabled={busy}
          >{rt.t('login.send')}{#if busy}<Spinner />{:else}<ArrowRightIcon class="mq-arrow" />{/if}</Button
        >
      </form>
    {/if}
  </section>
</div>
