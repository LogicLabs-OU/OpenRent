<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { LOCALES, LOCALE_NAMES } from '@openrent/i18n';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';

  /** Storefront languages (FR-SF-6): which ones customers can pick and which one is the default. */
  let { settings, onsaved }: { settings: any; onsaved: () => void } = $props();
  // svelte-ignore state_referenced_locally
  let enabled = $state<string[]>([...(settings.storefront.locales ?? ['en'])]);
  // svelte-ignore state_referenced_locally
  let defaultLocale = $state<string>(settings.storefront.default_locale ?? 'en');
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  function toggle(l: string, on: boolean) {
    enabled = on ? LOCALES.filter((x) => x === l || enabled.includes(x)) : enabled.filter((x) => x !== l);
  }

  async function save() {
    saving = true;
    errors = {};
    try {
      await api.patch('/tenant/settings', { storefront: { locales: enabled, default_locale: defaultLocale } });
      toast.success(t('common.saved'));
      onsaved();
    } catch (e) {
      errors = fieldErrors(e);
      if (!Object.keys(errors).length) notifyError(e);
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root data-testid="language-settings">
  <Card.Header>
    <Card.Title>{t('settings.languages')}</Card.Title>
    <Card.Description>{t('settings.languages_hint')}</Card.Description>
  </Card.Header>
  <Card.Content>
    <Field.Group>
      <Field.Set>
        <Field.Legend variant="label">{t('settings.languages_enabled')}</Field.Legend>
        <div class="grid gap-3 sm:grid-cols-3">
          {#each LOCALES as l (l)}
            <Field.Field orientation="horizontal">
              <Checkbox id={`lang-${l}`} checked={enabled.includes(l)} onCheckedChange={(v) => toggle(l, !!v)} />
              <Field.Label for={`lang-${l}`} class="font-normal" lang={l}>{LOCALE_NAMES[l]}</Field.Label>
            </Field.Field>
          {/each}
        </div>
        {#if errors['storefront.locales']}<Field.Error>{errors['storefront.locales']}</Field.Error>{/if}
      </Field.Set>
      <Field.Field data-invalid={!!errors['storefront.default_locale'] || undefined}>
        <Field.Label for="lang-default">{t('settings.default_language')}</Field.Label>
        <NativeSelect.Root id="lang-default" class="w-full sm:w-64" bind:value={defaultLocale} aria-invalid={!!errors['storefront.default_locale']}>
          {#each LOCALES as l (l)}<NativeSelect.Option value={l}>{LOCALE_NAMES[l]}</NativeSelect.Option>{/each}
        </NativeSelect.Root>
        {#if errors['storefront.default_locale']}<Field.Error>{errors['storefront.default_locale']}</Field.Error>{:else}<Field.Description>{t('settings.default_language_hint')}</Field.Description>{/if}
      </Field.Field>
    </Field.Group>
  </Card.Content>
  <Card.Footer><Button onclick={save} disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button></Card.Footer>
</Card.Root>
