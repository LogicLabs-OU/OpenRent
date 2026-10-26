<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Table from '@openrent/ui/table';
  import * as Alert from '@openrent/ui/alert';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import SendIcon from '@lucide/svelte/icons/send';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { LOCALE_NAMES, type Locale } from '@openrent/i18n';
  import { shopLocales } from './shop-locales.svelte.ts';
  import { api, session, t, toast, notifyError, fieldErrors } from '#lib';
  import EmailDelivery from './email-delivery.svelte';

  const SMTP = 'notify-smtp';
  let plugin = $state<any>(null);
  let smtp = $state({ host: '', port: '', security: 'starttls', username: '', password: '', from: '', reply_to: '' });
  let smtpErrors = $state<Record<string, string>>({});
  let savingSmtp = $state(false);
  let testTo = $state(session.me?.user.email ?? '');
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; message: string } | null>(null);

  let templates = $state<any[]>([]);
  let editing = $state<any>(null);
  let draft = $state({ subject: '', body: '', enabled: true });
  let draftErrors = $state<Record<string, string>>({});
  let preview = $state<{ subject: string; html: string } | null>(null);
  let savingTpl = $state(false);
  /** Templates are edited per storefront language; each has its own subject and body. */
  let tplLocale = $state('');

  /** Email plugins the shop can send with; the choice shows only when there is more than one. */
  let channels = $state<any[]>([]);
  let emailChannel = $state('');

  async function loadChannels() {
    const [list, settings] = await Promise.all([api.get('/plugins'), api.get('/tenant/settings')]);
    channels = list.data.filter((p: any) => p.state === 'loaded' && p.provides.includes('notification:email'));
    emailChannel = settings.email_channel ?? '';
  }

  async function chooseChannel(id: string) {
    try {
      await api.patch('/tenant/settings', { email_channel: id || null });
      emailChannel = id;
      deliveryKey++;
      toast.success(t('common.saved'));
    } catch (err) {
      notifyError(err);
    }
  }
  const chosenPlugin = $derived(channels.find((c) => c.id === emailChannel) ?? null);

  async function load() {
    loadChannels().catch(notifyError);
    try {
      plugin = await api.get(`/plugins/${SMTP}`);
      const v = plugin.values;
      smtp = { host: v.host ?? '', port: v.port ? String(v.port) : '', security: v.security ?? 'starttls', username: v.username ?? '', password: '', from: v.from ?? '', reply_to: v.reply_to ?? '' };
    } catch {
      plugin = null;
    }
    try {
      await shopLocales.load();
      if (!tplLocale) tplLocale = shopLocales.default;
      templates = (await api.get(`/notification_templates?locale=${tplLocale}`)).data;
    } catch (e) {
      notifyError(e);
    }
  }
  load();

  let deliveryKey = $state(0);
  // Port 465 speaks TLS from the first byte; 25, 587 and 2525 start plain and upgrade with STARTTLS.
  const IMPLICIT_TLS = [465];
  const STARTTLS_PORTS = [25, 587, 2525];
  function portChanged() {
    const p = Number(smtp.port);
    if (IMPLICIT_TLS.includes(p)) smtp.security = 'tls';
    else if (STARTTLS_PORTS.includes(p) && smtp.security === 'tls') smtp.security = 'starttls';
  }
  const mismatch = $derived.by(() => {
    const p = Number(smtp.port);
    return (smtp.security === 'tls' && STARTTLS_PORTS.includes(p)) || (smtp.security === 'starttls' && IMPLICIT_TLS.includes(p));
  });
  const configured = $derived(!!plugin && (!!plugin.values.host || !!plugin.secrets.smtp_url));
  const usingInstallation = $derived(!!plugin && !plugin.values.host && plugin.secrets.smtp_url === 'installation');

  async function saveSmtp(e: SubmitEvent) {
    e.preventDefault();
    savingSmtp = true;
    smtpErrors = {};
    try {
      plugin = await api.patch(`/plugins/${SMTP}`, {
        config: {
          host: smtp.host || null,
          port: smtp.port ? Number(smtp.port) : null,
          security: smtp.security || null,
          username: smtp.username || null,
          ...(smtp.password ? { password: smtp.password } : {}),
          from: smtp.from || null,
          reply_to: smtp.reply_to || null,
        },
      });
      smtp.password = '';
      deliveryKey++;
      toast.success(t('email.saved_retrying'));
    } catch (err) {
      smtpErrors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^config\./, ''), v]));
      if (!Object.keys(smtpErrors).length) notifyError(err);
    } finally {
      savingSmtp = false;
    }
  }

  async function sendTest() {
    testing = true;
    testResult = null;
    try {
      await api.post('/notifications/actions/test_email', { to: testTo });
      testResult = { ok: true, message: t('email.test_sent', { to: testTo }) };
    } catch (err) {
      testResult = { ok: false, message: (err as Error).message };
    } finally {
      testing = false;
    }
  }

  function edit(tpl: any) {
    editing = tpl;
    draft = { subject: tpl.subject, body: tpl.body, enabled: tpl.enabled };
    draftErrors = {};
    preview = null;
    renderPreview();
  }

  async function renderPreview() {
    if (!editing) return;
    try {
      preview = await api.post('/notification_templates/preview', { event: editing.event, subject: draft.subject, body: draft.body, locale: tplLocale });
      draftErrors = {};
    } catch (err) {
      draftErrors = fieldErrors(err);
      if (!Object.keys(draftErrors).length) notifyError(err);
    }
  }

  async function saveTemplate() {
    if (!editing) return;
    savingTpl = true;
    try {
      await api.patch(`/notification_templates/${editing.event}`, { subject: draft.subject, body: draft.body, enabled: draft.enabled, locale: tplLocale });
      toast.success(t('common.saved'));
      editing = null;
      await load();
    } catch (err) {
      draftErrors = fieldErrors(err);
      if (!Object.keys(draftErrors).length) notifyError(err);
    } finally {
      savingTpl = false;
    }
  }

  async function sendTemplateTest() {
    if (!editing || !testTo) return;
    try {
      await api.post(`/notification_templates/${editing.event}/test`, { to: testTo, locale: tplLocale });
      toast.success(t('email.template_test_queued', { to: testTo }));
    } catch (err) {
      notifyError(err);
    }
  }
</script>

{#if channels.length > 1}
  <Card.Root>
    <Card.Header>
      <Card.Title>{t('email.channel_title')}</Card.Title>
      <Card.Description>{t('email.channel_hint')}</Card.Description>
    </Card.Header>
    <Card.Content>
      <Field.Field class="max-w-sm">
        <Field.Label for="email-channel">{t('email.channel')}</Field.Label>
        <NativeSelect id="email-channel" class="w-full" value={emailChannel} onchange={(e) => chooseChannel((e.currentTarget as HTMLSelectElement).value)}>
          <NativeSelectOption value="">{t('email.channel_auto')}</NativeSelectOption>
          {#each channels as c (c.id)}<NativeSelectOption value={c.id}>{c.name}</NativeSelectOption>{/each}
        </NativeSelect>
        {#if chosenPlugin && chosenPlugin.id !== SMTP}
          <Field.Description>{t('email.channel_setup', { name: chosenPlugin.name })} <a class="underline" href="/plugins">{t('nav.plugins')}</a></Field.Description>
        {/if}
      </Field.Field>
    </Card.Content>
  </Card.Root>
{/if}

{#if plugin}
  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        {t('email.server_title')}
        {#if configured}<Badge variant="outline" class="gap-1 border-emerald-600/30 text-emerald-700 dark:text-emerald-300"><CircleCheckIcon class="size-3" />{t('email.configured')}</Badge>{:else}<Badge variant="outline">{t('email.not_configured')}</Badge>{/if}
      </Card.Title>
      <Card.Description>{t('email.server_hint')}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if usingInstallation}
        <Alert.Root class="mb-6"><CircleCheckIcon /><Alert.Title>{t('email.installation_default')}</Alert.Title></Alert.Root>
      {/if}
      {#if !plugin.enabled}
        <Alert.Root variant="destructive" class="mb-6"><CircleAlertIcon /><Alert.Title>{t('email.plugin_disabled')}</Alert.Title></Alert.Root>
      {/if}
      <form id="smtp-form" onsubmit={saveSmtp}>
        <Field.Group>
          <div class="grid gap-6 sm:grid-cols-[1fr_8rem_10rem]">
            <Field.Field data-invalid={!!smtpErrors.host || undefined}>
              <Field.Label for="smtp-host">{t('email.host')}</Field.Label>
              <Input id="smtp-host" placeholder="smtp.example.com" bind:value={smtp.host} aria-invalid={!!smtpErrors.host} />
              {#if smtpErrors.host}<Field.Error>{smtpErrors.host}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!smtpErrors.port || undefined}>
              <Field.Label for="smtp-port">{t('email.port')}</Field.Label>
              <Input id="smtp-port" type="number" placeholder="587" bind:value={smtp.port} onchange={portChanged} aria-invalid={!!smtpErrors.port || mismatch} />
              {#if smtpErrors.port}<Field.Error>{smtpErrors.port}</Field.Error>{/if}
            </Field.Field>
            <Field.Field>
              <Field.Label for="smtp-sec">{t('email.security')}</Field.Label>
              <NativeSelect id="smtp-sec" class="w-full" bind:value={smtp.security}>
                <NativeSelectOption value="starttls">{t('email.security.starttls')}</NativeSelectOption>
                <NativeSelectOption value="tls">{t('email.security.tls')}</NativeSelectOption>
                <NativeSelectOption value="none">{t('email.security.none')}</NativeSelectOption>
              </NativeSelect>
            </Field.Field>
          </div>
          {#if mismatch}
            <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{t('email.port_mismatch', { port: smtp.port })}</Alert.Title></Alert.Root>
          {/if}
          <div class="grid gap-6 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="smtp-user">{t('email.username')}</Field.Label>
              <Input id="smtp-user" autocomplete="off" bind:value={smtp.username} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="smtp-pass">{t('email.password')}</Field.Label>
              <Input id="smtp-pass" type="password" autocomplete="new-password" bind:value={smtp.password} placeholder={plugin.secrets.password ? t('plugins.secret_tenant') : ''} />
            </Field.Field>
          </div>
          <div class="grid gap-6 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="smtp-from">{t('settings.email_from')}</Field.Label>
              <Input id="smtp-from" placeholder={t('settings.email_from_placeholder')} bind:value={smtp.from} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="smtp-reply">{t('email.reply_to')}</Field.Label>
              <Input id="smtp-reply" type="email" bind:value={smtp.reply_to} />
            </Field.Field>
          </div>
        </Field.Group>
      </form>
    </Card.Content>
    <Card.Footer class="flex-col items-stretch gap-4 border-t sm:flex-row sm:items-end">
      <Button type="submit" form="smtp-form" disabled={savingSmtp}>{#if savingSmtp}<Spinner />{/if}{t('common.save')}</Button>
      <div class="flex flex-1 flex-col gap-1.5 sm:items-end">
        <div class="flex w-full gap-2 sm:w-auto">
          <Input type="email" class="sm:w-64" bind:value={testTo} aria-label={t('email.test_to')} placeholder={t('email.test_to')} />
          <Button variant="outline" disabled={testing || !testTo || !configured} onclick={sendTest}>{#if testing}<Spinner />{:else}<SendIcon />{/if}{t('email.send_test')}</Button>
        </div>
        {#if testResult}<p class={testResult.ok ? 'text-sm text-emerald-700 dark:text-emerald-300' : 'text-destructive text-sm'} role="status">{testResult.message}</p>{/if}
      </div>
    </Card.Footer>
  </Card.Root>
{/if}

{#key deliveryKey}<EmailDelivery />{/key}

<Card.Root>
  <Card.Header>
    <Card.Title>{t('email.templates_title')}</Card.Title>
    <Card.Description>{t('email.templates_hint')}</Card.Description>
    {#if shopLocales.list.length > 1}
      <Card.Action>
        <NativeSelect value={tplLocale} onchange={(e) => { tplLocale = (e.currentTarget as HTMLSelectElement).value; load(); }} aria-label={t('language.label')} data-testid="template-language">
          {#each shopLocales.list as l (l)}<NativeSelectOption value={l}>{LOCALE_NAMES[l as Locale] ?? l}</NativeSelectOption>{/each}
        </NativeSelect>
      </Card.Action>
    {/if}
  </Card.Header>
  <Card.Content>
    <div class="rounded-lg border">
      <Table.Root>
        <Table.Header><Table.Row><Table.Head>{t('email.col.message')}</Table.Head><Table.Head>{t('email.col.subject')}</Table.Head><Table.Head class="w-28"></Table.Head></Table.Row></Table.Header>
        <Table.Body>
          {#each templates.filter((x) => x.event !== 'magic_link') as tpl (tpl.id)}
            <Table.Row>
              <Table.Cell>
                <div class="font-medium">{t(`email.event.${tpl.event}` as any)}</div>
                <div class="flex gap-1.5">{#if !tpl.builtin}<Badge variant="secondary">{t('email.customised')}</Badge>{/if}{#if !tpl.enabled}<Badge variant="outline">{t('email.off')}</Badge>{/if}</div>
              </Table.Cell>
              <Table.Cell class="text-muted-foreground max-w-80 truncate">{tpl.subject}</Table.Cell>
              <Table.Cell class="text-right"><Button size="sm" variant="ghost" onclick={() => edit(tpl)}><PencilIcon />{t('common.edit')}</Button></Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </Card.Content>
</Card.Root>

<Sheet.Root open={!!editing} onOpenChange={(o) => !o && (editing = null)}>
  <Sheet.Content class="data-[side=right]:w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
    {#if editing}
      <Sheet.Header>
        <Sheet.Title>{t(`email.event.${editing.event}` as any)}</Sheet.Title>
        <Sheet.Description>{t('email.editor_hint')}</Sheet.Description>
      </Sheet.Header>
      <div class="grid gap-6 px-4 lg:grid-cols-2">
        <Field.Group>
          <Field.Field data-invalid={!!draftErrors.subject || undefined}>
            <Field.Label for="tpl-subject">{t('email.col.subject')}</Field.Label>
            <Input id="tpl-subject" bind:value={draft.subject} onchange={renderPreview} />
          </Field.Field>
          <Field.Field data-invalid={!!draftErrors.body || undefined}>
            <Field.Label for="tpl-body">{t('email.body')}</Field.Label>
            <Textarea id="tpl-body" class="min-h-80 font-mono text-xs" bind:value={draft.body} onchange={renderPreview} aria-invalid={!!draftErrors.body} />
            {#if draftErrors.body}<Field.Error>{draftErrors.body}</Field.Error>{:else}<Field.Description>{t('email.variables_hint')}</Field.Description>{/if}
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch id="tpl-enabled" bind:checked={draft.enabled} />
            <Field.Label for="tpl-enabled">{t('email.enabled')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">{t('email.preview')}</span>
            <Button size="sm" variant="ghost" onclick={renderPreview}><EyeIcon />{t('email.refresh_preview')}</Button>
          </div>
          {#if preview}
            <div class="text-muted-foreground rounded-md border px-3 py-2 text-sm"><span class="font-medium">{t('email.col.subject')}:</span> {preview.subject}</div>
            <iframe title={t('email.preview')} sandbox="" class="h-96 w-full rounded-md border bg-white" srcdoc={preview.html}></iframe>
          {/if}
        </div>
      </div>
      <Sheet.Footer class="flex-row flex-wrap">
        <Button disabled={savingTpl} onclick={saveTemplate}>{#if savingTpl}<Spinner />{/if}{t('common.save')}</Button>
        <Button variant="outline" disabled={!testTo} onclick={sendTemplateTest}><SendIcon />{t('email.send_test')}</Button>
        <Sheet.Close>{#snippet child({ props })}<Button variant="ghost" {...props}>{t('common.cancel')}</Button>{/snippet}</Sheet.Close>
      </Sheet.Footer>
    {/if}
  </Sheet.Content>
</Sheet.Root>
