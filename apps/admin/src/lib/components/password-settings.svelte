<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { api, session, t, toast, notifyError, fieldErrors } from '#lib';

  /** Your own password. After an invitation or a reset there is none yet, so no current one is asked for. */
  let current = $state('');
  let password = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const hasPassword = $derived(session.me?.user.has_password !== false);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      await api.post('/auth/me/password', { password, current_password: hasPassword ? current : undefined });
      toast.success(t('password.saved'));
      current = password = '';
      await session.load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }
</script>

<Card.Root class="mb-6">
  <Card.Header>
    <Card.Title>{t('password.title')}</Card.Title>
    <Card.Description>{hasPassword ? t('password.hint') : t('password.none_yet')}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="flex flex-col gap-4 sm:max-w-sm" onsubmit={save} novalidate>
      {#if hasPassword}
        <Field.Field data-invalid={!!errors.current_password || undefined}>
          <Field.Label for="pw-current">{t('password.current')}</Field.Label>
          <Input id="pw-current" type="password" autocomplete="current-password" bind:value={current} aria-invalid={!!errors.current_password} />
          {#if errors.current_password}<Field.Error>{errors.current_password}</Field.Error>{/if}
        </Field.Field>
      {/if}
      <Field.Field data-invalid={!!errors.password || undefined}>
        <Field.Label for="pw-new">{t('password.new')}</Field.Label>
        <Input id="pw-new" type="password" autocomplete="new-password" bind:value={password} aria-invalid={!!errors.password} />
        {#if errors.password}<Field.Error>{errors.password}</Field.Error>{:else}<Field.Description>{t('password.rules')}</Field.Description>{/if}
      </Field.Field>
      <div><Button type="submit" disabled={busy || !password}>{#if busy}<Spinner />{/if}{t('password.save')}</Button></div>
    </form>
  </Card.Content>
</Card.Root>
