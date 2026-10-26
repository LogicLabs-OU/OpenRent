<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as InputGroup from '@openrent/ui/input-group';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { StatusBadge } from '@openrent/ui/openrent';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { api, t, toast, notifyError, fieldErrors, session } from '#lib';

  /**
   * One payment provider (Stripe, Mollie, PayPal, or a plugin's): its settings from the plugin's fields,
   * the webhook URL to give the provider, and turning it on or off. Secrets are never shown, only set.
   */
  let { provider, onchange }: { provider: any; onchange: () => void } = $props();
  let values = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  $effect(() => {
    values = Object.fromEntries((provider.settings ?? []).map((f: any) => [f.key, f.type === 'secret' ? '' : String(provider.values?.[f.key] ?? '')]));
  });
  const id = (key: string) => `pp-${provider.id}-${key}`;

  async function save() {
    busy = true;
    errors = {};
    try {
      // Empty secrets keep what is stored.
      const config = Object.fromEntries((provider.settings ?? []).filter((f: any) => f.type !== 'secret' || values[f.key]).map((f: any) => [f.key, values[f.key]]));
      await api.patch(`/payment_providers/${provider.id}`, { config });
      toast.success(t('settings.provider_saved', { name: provider.display_name }));
      onchange();
    } catch (e) {
      errors = Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^config\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(e);
    } finally {
      busy = false;
    }
  }

  async function toggle() {
    busy = true;
    try {
      await api.patch(`/payment_providers/${provider.id}`, { enabled: !provider.enabled });
      toast.success(provider.enabled ? t('settings.provider_disabled', { name: provider.display_name }) : t('settings.provider_enabled', { name: provider.display_name }));
      onchange();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('common.copied')));
</script>

<Card.Root data-testid="payment-provider" data-provider={provider.id}>
  <Card.Header>
    <Card.Title>{provider.display_name}</Card.Title>
    <Card.Description>{t(`settings.provider_hint.${provider.id}` as any) === `settings.provider_hint.${provider.id}` ? t('settings.provider_hint') : t(`settings.provider_hint.${provider.id}` as any)}</Card.Description>
    <Card.Action>
      <StatusBadge
        status={provider.configured && provider.enabled ? 'enabled' : provider.configured ? 'disabled' : 'pending'}
        label={!provider.configured ? t('settings.provider_not_configured') : provider.enabled ? t('settings.provider_on', { mode: provider.mode }) : t('settings.provider_off')}
      />
    </Card.Action>
  </Card.Header>
  <Card.Content>
    <Field.Group>
      {#each provider.settings ?? [] as f (f.key)}
        <Field.Field data-invalid={!!errors[f.key] || undefined}>
          <Field.Label for={id(f.key)}>{f.label}</Field.Label>
          {#if f.type === 'select'}
            <NativeSelect.Root id={id(f.key)} class="w-full" bind:value={values[f.key]}>
              {#each f.options ?? [] as o (o)}<NativeSelect.Option value={o}>{o}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          {:else}
            <Input id={id(f.key)} type={f.type === 'secret' ? 'password' : 'text'} autocomplete="off" placeholder={f.type === 'secret' && provider.secrets?.[f.key] ? t('settings.secret_set') : ''} bind:value={values[f.key]} aria-invalid={!!errors[f.key]} />
          {/if}
          {#if errors[f.key]}<Field.Error>{errors[f.key]}</Field.Error>{:else if f.help}<Field.Description>{f.help}</Field.Description>{/if}
        </Field.Field>
      {/each}
      <Field.Field>
        <Field.Label for={id('webhook')}>{t('settings.webhook_url')}</Field.Label>
        <InputGroup.Root>
          <InputGroup.Input id={id('webhook')} readonly class="font-mono text-xs" value={provider.webhook_url} />
          <InputGroup.Addon align="inline-end"><InputGroup.Button size="icon-xs" aria-label={t('common.copy')} onclick={() => copy(provider.webhook_url)}><CopyIcon /></InputGroup.Button></InputGroup.Addon>
        </InputGroup.Root>
      </Field.Field>
    </Field.Group>
  </Card.Content>
  {#if session.can('tenant:write')}
    <Card.Footer class="gap-2">
      <Button onclick={save} disabled={busy}>{t('settings.save_keys')}</Button>
      <Button variant="outline" onclick={toggle} disabled={busy}>{provider.enabled ? t('common.disable') : t('common.enable')}</Button>
    </Card.Footer>
  {/if}
</Card.Root>
