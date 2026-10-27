<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { api, session, t, fieldErrors } from '#lib';
  import { to } from '#lib/nav.ts';

  /** Self-serve sign-up on a managed installation (OPENRENT_SIGNUP=1): a new shop and its owner. */
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones: string[] = (Intl as any).supportedValuesOf?.('timeZone') ?? [zone];
  const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF', 'PLN', 'CZK', 'CAD', 'AUD'];
  let enabled = $state<boolean | null>(null);
  let form = $state({ owner: { name: '', email: '', password: '' }, tenant: { name: '', currency: 'EUR', timezone: zone }, location: { name: '' } });
  let errors = $state<Record<string, string>>({});
  let error = $state('');
  let busy = $state(false);

  onMount(async () => {
    enabled = (await api.get('/signup').catch(() => ({ enabled: false }))).enabled;
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    errors = {};
    try {
      await api.post('/signup', { owner: form.owner, tenant: form.tenant, location: { name: form.location.name || t('setup.default_location') } });
      await session.load();
      goto(to('/'));
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{t('signup.title')} · OpenRent</title></svelte:head>

<div class="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
  <div class="w-full max-w-xl">
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-xl">{t('signup.title')}</Card.Title>
        <Card.Description>{enabled === false ? t('signup.closed') : t('signup.subtitle')}</Card.Description>
      </Card.Header>
      {#if enabled === null}
        <Card.Content><Spinner /></Card.Content>
      {:else if enabled}
        <Card.Content>
          <form onsubmit={submit}>
            <Field.Group>
              {#if error}<Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{error}</Alert.Title></Alert.Root>{/if}
              <Field.Set>
                <Field.Legend>{t('setup.owner')}</Field.Legend>
                <Field.Group class="grid gap-4 sm:grid-cols-2">
                  <Field.Field><Field.Label for="on">{t('field.name')}</Field.Label><Input id="on" required autocomplete="name" bind:value={form.owner.name} /></Field.Field>
                  <Field.Field data-invalid={!!errors['owner.email'] || undefined}>
                    <Field.Label for="oe">{t('field.email')}</Field.Label>
                    <Input id="oe" type="email" required autocomplete="email" bind:value={form.owner.email} aria-invalid={!!errors['owner.email'] || undefined} />
                    {#if errors['owner.email']}<Field.Error>{errors['owner.email']}</Field.Error>{/if}
                  </Field.Field>
                  <Field.Field class="sm:col-span-2" data-invalid={!!errors['owner.password'] || undefined}>
                    <Field.Label for="op">{t('field.password')}</Field.Label>
                    <Input id="op" type="password" minlength={8} required autocomplete="new-password" bind:value={form.owner.password} aria-invalid={!!errors['owner.password'] || undefined} />
                    {#if errors['owner.password']}<Field.Error>{errors['owner.password']}</Field.Error>{:else}<Field.Description>{t('signup.password_hint')}</Field.Description>{/if}
                  </Field.Field>
                </Field.Group>
              </Field.Set>
              <Field.Separator />
              <Field.Set>
                <Field.Legend>{t('setup.business')}</Field.Legend>
                <Field.Group class="grid gap-4 sm:grid-cols-2">
                  <Field.Field class="sm:col-span-2"><Field.Label for="tn">{t('setup.shop_name')}</Field.Label><Input id="tn" required bind:value={form.tenant.name} /></Field.Field>
                  <Field.Field>
                    <Field.Label for="tc">{t('field.currency')}</Field.Label>
                    <NativeSelect.Root id="tc" class="w-full" bind:value={form.tenant.currency}>{#each CURRENCIES as c (c)}<NativeSelect.Option value={c}>{c}</NativeSelect.Option>{/each}</NativeSelect.Root>
                  </Field.Field>
                  <Field.Field>
                    <Field.Label for="tz">{t('field.timezone')}</Field.Label>
                    <NativeSelect.Root id="tz" class="w-full" bind:value={form.tenant.timezone}>{#each zones as z (z)}<NativeSelect.Option value={z}>{z}</NativeSelect.Option>{/each}</NativeSelect.Root>
                  </Field.Field>
                  <Field.Field class="sm:col-span-2"><Field.Label for="ln">{t('setup.first_location')}</Field.Label><Input id="ln" placeholder={t('setup.default_location')} bind:value={form.location.name} /></Field.Field>
                </Field.Group>
              </Field.Set>
              <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('signup.submit')}</Button>
            </Field.Group>
          </form>
        </Card.Content>
      {/if}
      <Card.Footer><Button variant="link" class="px-0" href={to('/login')}>{t('signup.have_account')}</Button></Card.Footer>
    </Card.Root>
  </div>
</div>
