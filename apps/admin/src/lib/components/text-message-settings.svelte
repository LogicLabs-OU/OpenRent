<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import SendIcon from '@lucide/svelte/icons/send';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';

  /**
   * Text messages (FR-NOT-4): which plugin sends booking updates by SMS and by WhatsApp, to customers
   * who asked for them, and a test message to check the setup.
   */
  type Kind = 'sms' | 'whatsapp';
  let plugins = $state<{ sms: any[]; whatsapp: any[] }>({ sms: [], whatsapp: [] });
  let chosen = $state<Record<Kind, string>>({ sms: '', whatsapp: '' });
  let testTo = $state('');
  let testKind = $state<Kind>('sms');
  let testing = $state(false);
  let testError = $state('');
  let testResult = $state('');

  async function load() {
    const [list, settings] = await Promise.all([api.get('/plugins'), api.get('/tenant/settings')]);
    const loaded = list.data.filter((p: any) => p.state === 'loaded');
    plugins = { sms: loaded.filter((p: any) => p.provides.includes('notification:sms')), whatsapp: loaded.filter((p: any) => p.provides.includes('notification:whatsapp')) };
    chosen = { sms: settings.sms_channel ?? '', whatsapp: settings.whatsapp_channel ?? '' };
    if (!chosen.sms && chosen.whatsapp) testKind = 'whatsapp';
  }
  load().catch(notifyError);

  async function choose(kind: Kind, id: string) {
    try {
      await api.patch('/tenant/settings', { [`${kind}_channel`]: id || null });
      chosen = { ...chosen, [kind]: id };
      toast.success(t('common.saved'));
    } catch (err) {
      notifyError(err);
    }
  }

  async function sendTest(e: SubmitEvent) {
    e.preventDefault();
    testing = true;
    testError = '';
    testResult = '';
    try {
      const r = await api.post('/notifications/actions/test_text', { to: testTo, channel: testKind });
      testResult = t('email.text_test_sent', { to: r.to });
    } catch (err) {
      testError = fieldErrors(err).to ?? '';
      if (!testError) testError = (err as Error).message;
    } finally {
      testing = false;
    }
  }
</script>

{#if plugins.sms.length || plugins.whatsapp.length}
  <Card.Root data-testid="text-messages">
    <Card.Header>
      <Card.Title>{t('email.texts_title')}</Card.Title>
      <Card.Description>{t('email.texts_hint')}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-6">
      <div class="grid gap-6 sm:grid-cols-2">
        {#each (['sms', 'whatsapp'] as const).filter((k) => plugins[k].length) as kind (kind)}
          <Field.Field>
            <Field.Label for={`text-${kind}`}>{t(`email.texts_${kind}` as any)}</Field.Label>
            <NativeSelect id={`text-${kind}`} class="w-full" value={chosen[kind]} onchange={(e) => choose(kind, (e.currentTarget as HTMLSelectElement).value)}>
              <NativeSelectOption value="">{t('email.texts_off')}</NativeSelectOption>
              {#each plugins[kind] as p (p.id)}<NativeSelectOption value={p.id}>{p.name}</NativeSelectOption>{/each}
            </NativeSelect>
            <Field.Description>{t('email.texts_setup')} <a class="underline" href="/plugins">{t('nav.plugins')}</a></Field.Description>
          </Field.Field>
        {/each}
      </div>
      {#if chosen.sms || chosen.whatsapp}
        <form class="flex flex-col gap-2" onsubmit={sendTest}>
          <Field.Field data-invalid={!!testError || undefined}>
            <Field.Label for="text-test-to">{t('email.text_test_to')}</Field.Label>
            <div class="flex flex-wrap gap-2">
              <Input id="text-test-to" type="tel" class="sm:w-64" placeholder="+44 7700 900123" bind:value={testTo} aria-invalid={!!testError} />
              {#if chosen.sms && chosen.whatsapp}
                <NativeSelect class="w-40" bind:value={testKind} aria-label={t('email.text_test_channel')}>
                  <NativeSelectOption value="sms">{t('email.channel.sms')}</NativeSelectOption>
                  <NativeSelectOption value="whatsapp">{t('email.channel.whatsapp')}</NativeSelectOption>
                </NativeSelect>
              {/if}
              <Button type="submit" variant="outline" disabled={testing || !testTo}>{#if testing}<Spinner />{:else}<SendIcon />{/if}{t('email.send_test')}</Button>
            </div>
            {#if testError}<Field.Error>{testError}</Field.Error>{/if}
          </Field.Field>
          {#if testResult}<p class="text-sm text-emerald-700 dark:text-emerald-300" role="status">{testResult}</p>{/if}
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}
