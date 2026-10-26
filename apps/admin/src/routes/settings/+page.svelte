<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Tabs from '@openrent/ui/tabs';
  import * as Table from '@openrent/ui/table';
  import * as Dialog from '@openrent/ui/dialog';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as InputGroup from '@openrent/ui/input-group';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { Badge } from '@openrent/ui/badge';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { StatusBadge, PageHeader } from '@openrent/ui/openrent';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import EmailSettings from '#lib/components/email-settings.svelte';
  import CalendarFeeds from '#lib/components/calendar-feeds.svelte';
  import LanguageSettings from '#lib/components/language-settings.svelte';
  import LanguageTabs from '#lib/components/language-tabs.svelte';
  import LocationsSettings from '#lib/components/locations-settings.svelte';
  import CustomFieldsSettings from '#lib/components/custom-fields-settings.svelte';
  import DataExport from '#lib/components/data-export.svelte';
  import DomainsSettings from '#lib/components/domains-settings.svelte';
  import WidgetSites from '#lib/components/widget-sites.svelte';
  import StringOverrides from '#lib/components/string-overrides.svelte';
  import DocumentTemplates from '#lib/components/document-templates.svelte';
  import ReconciliationIssues from '#lib/components/reconciliation-issues.svelte';
  import { api, session, t, toast, notifyError, fieldErrors, rel, confirmAction, majorFromMinor, minorFromInput } from '#lib';

  const TABS = ['general', 'locations', 'domains', 'payments', 'email', 'policies', 'documents', 'translations', 'custom_fields', 'calendar', 'webhooks', 'api_keys', 'team', 'security'] as const;
  // ?tab=email opens a tab directly (links from the Plugins page and email errors).
  // Old links used ?tab=hours for what is now the locations tab.
  let tab = $state<string>(new URLSearchParams(location.search).get('tab')?.replace(/^hours$/, 'locations') ?? 'general');
  let tenant = $state<any>(null);
  let settings = $state<any>(null);
  let providers = $state<any[]>([]);
  let stripe = $state({ secret_key: '', publishable_key: '', webhook_secret: '' });
  let endpoints = $state<any[]>([]);
  let deliveries = $state<Record<string, any[]>>({});
  let keys = $state<any[]>([]);
  let users = $state<any[]>([]);
  let secret = $state<string | null>(null);
  let newEndpoint = $state({ url: '', events: '*' });
  let newKey = $state({ name: '', kind: 'secret' });
  let newUser = $state({ email: '', name: '', role: 'staff', password: '' });
  let totp = $state<{ secret: string; uri: string } | null>(null);
  let totpCode = $state('');

  async function load() {
    tenant = await api.get('/tenant');
    settings = await api.get('/tenant/settings');
    providers = (await api.get('/payment_providers')).data;
    endpoints = (await api.get('/webhook_endpoints')).data;
    keys = (await api.get('/api_keys')).data;
    users = (await api.get('/users')).data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  async function run(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      await load();
      return true;
    } catch (e) {
      notifyError(e);
      return false;
    }
  }
  const saveSettings = (patch: any, msg = t('common.saved')) => run(() => api.patch('/tenant/settings', patch), msg);
  let termsErrors = $state<Record<string, string>>({});
  /** Payment terms are validated by the API; problems show next to the field (error-handling §3.1). */
  async function saveTerms(patch: Record<string, unknown>) {
    termsErrors = {};
    try {
      await api.patch('/tenant/settings', { payment_terms: patch });
      toast.success(t('common.saved'));
      await load();
    } catch (e) {
      termsErrors = Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [k.replace(/^payment_terms\./, ''), v]));
      if (!Object.keys(termsErrors).length) notifyError(e);
    }
  }
  const stripeP = $derived(providers.find((p) => p.id === 'stripe'));
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('common.copied')));
</script>

<svelte:head><title>{t('nav.settings')} · OpenRent</title></svelte:head>
<PageHeader title={t('nav.settings')} description={t('settings.description')} />

{#if tenant && settings}
  <Tabs.Root bind:value={tab} class="gap-6">
    <Tabs.List class="h-auto flex-wrap justify-start">
      {#each TABS as x (x)}<Tabs.Trigger value={x}>{t(`settings.tab.${x}` as any)}</Tabs.Trigger>{/each}
    </Tabs.List>

    <Tabs.Content value="general" class="flex max-w-3xl flex-col gap-6">
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.business')}</Card.Title><Card.Description>{t('settings.business_hint', { currency: tenant.currency, tz: tenant.timezone, slug: tenant.slug })}</Card.Description></Card.Header>
        <Card.Content>
          <Field.Group class="grid gap-4 sm:grid-cols-2">
            <Field.Field><Field.Label for="sn">{t('setup.shop_name')}</Field.Label><Input id="sn" bind:value={tenant.name} /></Field.Field>
            <Field.Field><Field.Label for="ln">{t('settings.legal_name')}</Field.Label><Input id="ln" bind:value={tenant.legal_name} /></Field.Field>
            <Field.Field><Field.Label for="a1">{t('settings.street')}</Field.Label><Input id="a1" bind:value={tenant.address.line1} /></Field.Field>
            <Field.Field><Field.Label for="ac">{t('settings.city')}</Field.Label><Input id="ac" bind:value={tenant.address.city} /></Field.Field>
            <Field.Field><Field.Label for="ap">{t('settings.postal_code')}</Field.Label><Input id="ap" bind:value={tenant.address.postal_code} /></Field.Field>
            <Field.Field><Field.Label for="aco">{t('settings.country')}</Field.Label><Input id="aco" bind:value={tenant.address.country} /></Field.Field>
            <Field.Field><Field.Label for="tax">{t('field.tax_id')}</Field.Label><Input id="tax" value={tenant.tax_ids?.[0]?.value ?? ''} onchange={(e) => (tenant.tax_ids = [{ type: 'VAT', value: (e.target as HTMLInputElement).value }])} /></Field.Field>
            <Field.Field>
              <Field.Label for="bc">{t('settings.brand_colour')}</Field.Label>
              <div class="flex gap-2"><input id="bc" type="color" class="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1" value={tenant.branding.primary_color ?? '#0e7490'} onchange={(e) => (tenant.branding = { ...tenant.branding, primary_color: (e.target as HTMLInputElement).value })} /><Input value={tenant.branding.primary_color ?? ''} readonly class="font-mono" aria-label={t('settings.brand_colour')} /></div>
            </Field.Field>
            <Field.Field class="sm:col-span-2"><Field.Label for="logo">{t('settings.logo_url')}</Field.Label><Input id="logo" value={tenant.branding.logo_url ?? ''} onchange={(e) => (tenant.branding = { ...tenant.branding, logo_url: (e.target as HTMLInputElement).value })} /></Field.Field>
          </Field.Group>
        </Card.Content>
        <Card.Footer><Button onclick={() => run(() => api.patch('/tenant', { name: tenant.name, legal_name: tenant.legal_name, address: tenant.address, tax_ids: tenant.tax_ids, branding: tenant.branding }), t('common.saved'))}>{t('common.save')}</Button></Card.Footer>
      </Card.Root>
      <LanguageSettings {settings} onsaved={() => load().catch(notifyError)} />
      <WidgetSites origins={settings.widget_origins ?? []} />
      {#if session.can('tenant:write')}<DataExport />{/if}
    </Tabs.Content>

    <Tabs.Content value="locations" class="flex max-w-3xl flex-col gap-6"><LocationsSettings /></Tabs.Content>
    <Tabs.Content value="domains" class="flex max-w-3xl flex-col gap-6"><DomainsSettings /></Tabs.Content>
    <Tabs.Content value="translations" class="flex max-w-5xl flex-col gap-6"><StringOverrides /></Tabs.Content>
    <Tabs.Content value="custom_fields" class="flex max-w-4xl flex-col gap-6"><CustomFieldsSettings /></Tabs.Content>
    <Tabs.Content value="documents" class="flex max-w-4xl flex-col gap-6"><DocumentTemplates /></Tabs.Content>

    <Tabs.Content value="payments" class="flex max-w-3xl flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title>Stripe</Card.Title>
          <Card.Description>{t('settings.stripe_hint')}</Card.Description>
          {#if stripeP}<Card.Action><StatusBadge status={stripeP.configured ? 'enabled' : 'pending'} label={stripeP.configured ? t('settings.stripe_connected', { mode: stripeP.mode }) : t('settings.stripe_not_configured')} /></Card.Action>{/if}
        </Card.Header>
        {#if stripeP}
          <Card.Content>
            <Field.Group>
              <Field.Field><Field.Label for="sk">{t('settings.secret_key')}</Field.Label><Input id="sk" type="password" placeholder="sk_test_…" bind:value={stripe.secret_key} /><Field.Description>{t('settings.secret_kept')}</Field.Description></Field.Field>
              <Field.Field><Field.Label for="pk">{t('settings.publishable_key')}</Field.Label><Input id="pk" placeholder={stripeP.public_config?.publishable_key ?? 'pk_test_…'} bind:value={stripe.publishable_key} /></Field.Field>
              <Field.Field><Field.Label for="whs">{t('settings.webhook_secret')}</Field.Label><Input id="whs" type="password" placeholder="whsec_…" bind:value={stripe.webhook_secret} /></Field.Field>
              <Field.Field>
                <Field.Label for="whu">{t('settings.webhook_url')}</Field.Label>
                <InputGroup.Root><InputGroup.Input id="whu" readonly class="font-mono text-xs" value={stripeP.webhook_url} /><InputGroup.Addon align="inline-end"><InputGroup.Button size="icon-xs" aria-label={t('common.copy')} onclick={() => copy(stripeP.webhook_url)}><CopyIcon /></InputGroup.Button></InputGroup.Addon></InputGroup.Root>
                <Field.Description>{t('settings.webhook_events')}</Field.Description>
              </Field.Field>
            </Field.Group>
          </Card.Content>
          <Card.Footer class="gap-2">
            <Button onclick={() => run(() => api.patch('/payment_providers/stripe', { config: Object.fromEntries(Object.entries(stripe).filter(([, v]) => v)) }), t('settings.stripe_saved'))}>{t('settings.save_keys')}</Button>
            <Button variant="outline" onclick={() => run(() => api.patch('/payment_providers/stripe', { enabled: !stripeP.enabled }), stripeP.enabled ? t('settings.stripe_disabled') : t('settings.stripe_enabled'))}>{stripeP.enabled ? t('common.disable') : t('common.enable')}</Button>
          </Card.Footer>
        {:else}
          <Card.Content><p class="text-sm text-muted-foreground">{t('settings.stripe_missing')}</p></Card.Content>
        {/if}
      </Card.Root>
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.checkout')}</Card.Title></Card.Header>
        <Card.Content>
          <Field.Group>
            <Field.Field>
              <Field.Label for="sp">{t('settings.checkout_payment')}</Field.Label>
              <NativeSelect.Root id="sp" class="w-full" value={settings.storefront.payment} onchange={(e) => saveSettings({ storefront: { payment: (e.target as HTMLSelectElement).value } })}>
                <NativeSelect.Option value="none">{t('settings.pay_at_pickup')}</NativeSelect.Option><NativeSelect.Option value="stripe">{t('settings.pay_online')}</NativeSelect.Option>
              </NativeSelect.Root>
            </Field.Field>
            <Field.Field>
              <Field.Label for="dp">{t('settings.deposit_policy')}</Field.Label>
              <NativeSelect.Root id="dp" class="w-full" value={settings.deposit_policy.mode} onchange={(e) => saveSettings({ deposit_policy: { mode: (e.target as HTMLSelectElement).value } })}>
                <NativeSelect.Option value="auto">{t('settings.deposit_auto')}</NativeSelect.Option><NativeSelect.Option value="none">{t('settings.deposit_none')}</NativeSelect.Option>
              </NativeSelect.Root>
            </Field.Field>
            <Field.Field>
              <Field.Label for="dad">{t('settings.deposit_days')}</Field.Label>
              <Input id="dad" type="number" min="0" max="6" class="w-24" value={settings.deposit_authorize_days_before} onchange={(e) => saveSettings({ deposit_authorize_days_before: Number((e.target as HTMLInputElement).value) })} />
              <Field.Description>{t('settings.deposit_days_hint')}</Field.Description>
            </Field.Field>
            <Field.Field>
              <Field.Label for="dxp">{t('settings.deposit_expiry_policy')}</Field.Label>
              <NativeSelect.Root id="dxp" class="w-full" value={settings.deposit_expiry_policy} onchange={(e) => saveSettings({ deposit_expiry_policy: (e.target as HTMLSelectElement).value })}>
                {#each ['notify', 'reauthorize', 'convert_to_charge'] as x (x)}<NativeSelect.Option value={x}>{t(`settings.deposit_expiry.${x}` as any)}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
              <Field.Description>{t('settings.deposit_expiry_hint')}</Field.Description>
            </Field.Field>
          </Field.Group>
        </Card.Content>
      </Card.Root>
      <ReconciliationIssues />
      <Card.Root data-testid="payment-terms">
        <Card.Header><Card.Title>{t('settings.payment_terms')}</Card.Title><Card.Description>{t('settings.payment_terms_hint')}</Card.Description></Card.Header>
        <Card.Content>
          <Field.Group>
            <Field.Field>
              <Field.Label for="pt-up">{t('settings.upfront')}</Field.Label>
              <NativeSelect.Root id="pt-up" class="w-full sm:w-80" value={settings.payment_terms.upfront} onchange={(e) => saveTerms({ upfront: (e.target as HTMLSelectElement).value })}>
                {#each ['full', 'percent', 'fixed'] as x (x)}<NativeSelect.Option value={x}>{t(`settings.upfront.${x}` as any)}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
            </Field.Field>
            {#if settings.payment_terms.upfront === 'percent'}
              <Field.Field>
                <Field.Label for="pt-pct">{t('settings.upfront_percent')}</Field.Label>
                <Input id="pt-pct" type="number" min="1" max="100" class="w-28" aria-invalid={!!termsErrors.percent_bp} value={settings.payment_terms.percent_bp / 100} onchange={(e) => saveTerms({ percent_bp: Math.round(Number((e.target as HTMLInputElement).value) * 100) })} />
                {#if termsErrors.percent_bp}<Field.Error>{termsErrors.percent_bp}</Field.Error>{/if}
              </Field.Field>
            {:else if settings.payment_terms.upfront === 'fixed'}
              <Field.Field>
                <Field.Label for="pt-fix">{t('settings.upfront_fixed')} ({session.currency})</Field.Label>
                <Input id="pt-fix" inputmode="decimal" class="w-32" value={majorFromMinor(settings.payment_terms.fixed_amount)} onchange={(e) => saveTerms({ fixed_amount: minorFromInput((e.target as HTMLInputElement).value) })} />
                {#if termsErrors.fixed_amount}<Field.Error>{termsErrors.fixed_amount}</Field.Error>{/if}
              </Field.Field>
            {/if}
            {#if settings.payment_terms.upfront !== 'full'}
              <Field.Field>
                <Field.Label for="pt-days">{t('settings.balance_days')}</Field.Label>
                <Input id="pt-days" type="number" min="0" max="60" class="w-28" value={settings.payment_terms.balance_due_days_before} onchange={(e) => saveTerms({ balance_due_days_before: Number((e.target as HTMLInputElement).value) })} />
                {#if termsErrors.balance_due_days_before}<Field.Error>{termsErrors.balance_due_days_before}</Field.Error>{:else}<Field.Description>{t('settings.balance_days_hint')}</Field.Description>{/if}
              </Field.Field>
            {/if}
          </Field.Group>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="email" class="flex max-w-4xl flex-col gap-6">
      <EmailSettings />
      <Card.Root>
        <Card.Header><Card.Title>{t('email.staff_title')}</Card.Title><Card.Description>{t('email.staff_hint')}</Card.Description></Card.Header>
        <Card.Content>
          <Field.Group>
            <Field.Field><Field.Label for="se">{t('settings.staff_email')}</Field.Label><Input id="se" type="email" value={settings.staff_email ?? ''} onchange={(e) => saveSettings({ staff_email: (e.target as HTMLInputElement).value || null })} /><Field.Description>{t('settings.staff_email_hint')}</Field.Description></Field.Field>
          </Field.Group>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="policies" class="flex max-w-3xl flex-col gap-6">
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.terms')}</Card.Title><Card.Description>{t('settings.terms_hint', { version: settings.terms.version })}</Card.Description></Card.Header>
        <Card.Content>
          <!-- The default language edits the base text; the others hold translations shown in their storefront language. -->
          <LanguageTabs locales={[settings.storefront.default_locale, ...settings.storefront.locales.filter((l: string) => l !== settings.storefront.default_locale)]}>
            {#snippet children(l: string, isDefault: boolean)}
              {#if isDefault}
                <Textarea class="min-h-48" bind:value={settings.terms.text} aria-label={t('settings.terms')} />
              {:else}
                <Textarea class="min-h-48" lang={l} placeholder={settings.terms.text} value={settings.terms.translations?.[l] ?? ''} oninput={(e) => (settings.terms.translations = { ...(settings.terms.translations ?? {}), [l]: (e.currentTarget as HTMLTextAreaElement).value })} aria-label={t('settings.terms_in', { language: t(`language.${l}` as any) })} />
              {/if}
            {/snippet}
          </LanguageTabs>
        </Card.Content>
        <Card.Footer><Button onclick={() => saveSettings({ terms: { text: settings.terms.text, translations: settings.terms.translations ?? {}, version: String(Number(settings.terms.version) + 1) } }, t('settings.terms_saved'))}>{t('common.save')}</Button></Card.Footer>
      </Card.Root>
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.rules')}</Card.Title></Card.Header>
        <Card.Content>
          <Field.Group class="grid gap-4 sm:grid-cols-3">
            <Field.Field><Field.Label for="qt">{t('settings.quote_hours')}</Field.Label><Input id="qt" type="number" value={settings.quote_ttl_hours} onchange={(e) => saveSettings({ quote_ttl_hours: Number((e.target as HTMLInputElement).value) })} /></Field.Field>
            <Field.Field><Field.Label for="lg">{t('settings.late_grace')}</Field.Label><Input id="lg" type="number" value={settings.late_grace_minutes} onchange={(e) => saveSettings({ late_grace_minutes: Number((e.target as HTMLInputElement).value) })} /></Field.Field>
            <Field.Field orientation="horizontal" class="sm:pt-6"><Switch id="lf" checked={settings.late_fees_enabled} onCheckedChange={(v) => saveSettings({ late_fees_enabled: v })} /><Field.Label for="lf">{t('settings.late_fees')}</Field.Label></Field.Field>
          </Field.Group>
          <Field.Separator class="my-4" />
          <p class="mb-2 text-sm font-medium">{t('settings.cancellation')}</p>
          <ul class="space-y-1 text-sm text-muted-foreground">{#each settings.cancellation_policy as tier}<li>{t('settings.cancellation_tier', { hours: tier.hours_before, pct: tier.refund_pct })}</li>{/each}</ul>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.waiver')}</Card.Title><Card.Description>{t('settings.waiver_hint')}</Card.Description></Card.Header>
        <Card.Content>
          <Field.Group class="grid gap-4 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="dwx">{t('settings.waiver_excess', { currency: session.currency })}</Field.Label>
              <Input id="dwx" type="number" min="0" step="0.01" value={majorFromMinor(settings.damage_waiver_excess)} onchange={(e) => saveSettings({ damage_waiver_excess: minorFromInput((e.target as HTMLInputElement).value) })} />
              <Field.Description>{t('settings.waiver_excess_hint')}</Field.Description>
            </Field.Field>
            <Field.Field orientation="horizontal" class="sm:pt-6">
              <Switch id="rwi" checked={settings.requires_waiver_or_insurance} onCheckedChange={(v) => saveSettings({ requires_waiver_or_insurance: v })} />
              <Field.Label for="rwi">{t('settings.require_waiver')}</Field.Label>
            </Field.Field>
          </Field.Group>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="webhooks" class="flex max-w-4xl flex-col gap-6">
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.tab.webhooks')}</Card.Title><Card.Description>{t('settings.webhooks_hint')}</Card.Description></Card.Header>
        <Card.Content class="flex flex-col gap-4">
          {#each endpoints as ep (ep.id)}
            <Card.Root size="sm" class="shadow-none">
              <Card.Header>
                <Card.Title class="truncate font-mono text-xs">{ep.url}</Card.Title>
                <Card.Description>{t('settings.events', { events: ep.events.join(', ') })}</Card.Description>
                <Card.Action><StatusBadge status={ep.status} label={t(`status.${ep.status}` as any)} /></Card.Action>
              </Card.Header>
              <Card.Content class="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onclick={() => run(() => api.post(`/webhook_endpoints/${ep.id}/actions/test`), t('settings.ping_queued'))}>{t('settings.send_test')}</Button>
                <Button size="sm" variant="outline" onclick={async () => (deliveries[ep.id] = (await api.get(`/webhook_endpoints/${ep.id}/deliveries`)).data)}>{t('settings.deliveries')}</Button>
                <Button size="sm" variant="outline" onclick={async () => { try { secret = (await api.post(`/webhook_endpoints/${ep.id}/actions/rotate_secret`)).secret; } catch (e) { notifyError(e); } }}>{t('settings.rotate_secret')}</Button>
                {#if ep.status !== 'enabled'}<Button size="sm" variant="outline" onclick={() => run(() => api.patch(`/webhook_endpoints/${ep.id}`, { status: 'enabled' }), t('settings.endpoint_enabled'))}>{t('common.enable')}</Button>{/if}
                <Button size="sm" variant="ghost" onclick={async () => { if (await confirmAction({ title: t('settings.delete_endpoint'), description: ep.url, confirmLabel: t('common.delete'), destructive: true })) run(() => api.del(`/webhook_endpoints/${ep.id}`), t('common.removed')); }}>{t('common.delete')}</Button>
              </Card.Content>
              {#if deliveries[ep.id]}
                <Card.Footer>
                  <Table.Root>
                    <Table.Body>
                      {#each deliveries[ep.id]! as dl (dl.id)}
                        <Table.Row>
                          <Table.Cell class="text-xs">{dl.event_type}</Table.Cell><Table.Cell><StatusBadge status={dl.status} label={t(`status.${dl.status}` as any)} /></Table.Cell>
                          <Table.Cell class="text-xs text-muted-foreground">{dl.response_code ?? dl.error ?? ''} · {t('settings.attempt', { n: dl.attempt })} · {rel(dl.created_at)}</Table.Cell>
                          <Table.Cell class="text-right">{#if dl.status === 'failed'}<Button size="sm" variant="ghost" onclick={() => run(() => api.post(`/webhook_deliveries/${dl.id}/actions/redeliver`), t('settings.redelivery_queued'))}>{t('settings.resend')}</Button>{/if}</Table.Cell>
                        </Table.Row>
                      {/each}
                    </Table.Body>
                  </Table.Root>
                </Card.Footer>
              {/if}
            </Card.Root>
          {/each}
          <Field.Group class="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Field.Field><Field.Label for="wu">{t('settings.endpoint_url')}</Field.Label><Input id="wu" placeholder="https://example.com/openrent-webhook" bind:value={newEndpoint.url} /></Field.Field>
            <Field.Field><Field.Label for="we">{t('settings.endpoint_events')}</Field.Label><Input id="we" placeholder={t('settings.endpoint_events_placeholder')} bind:value={newEndpoint.events} /></Field.Field>
            <Button onclick={async () => { try { secret = (await api.post('/webhook_endpoints', { url: newEndpoint.url, events: newEndpoint.events.split(',').map((s) => s.trim()).filter(Boolean) })).secret; newEndpoint = { url: '', events: '*' }; load(); } catch (e) { notifyError(e); } }}><PlusIcon />{t('settings.add_endpoint')}</Button>
          </Field.Group>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="calendar" class="max-w-4xl"><CalendarFeeds /></Tabs.Content>

    <Tabs.Content value="api_keys" class="max-w-4xl">
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.tab.api_keys')}</Card.Title><Card.Description>{t('settings.api_keys_hint')}</Card.Description></Card.Header>
        <Card.Content class="flex flex-col gap-4">
          <Table.Root>
            <Table.Body>
              {#each keys as k (k.id)}
                <Table.Row>
                  <Table.Cell class="font-medium">{k.name}</Table.Cell><Table.Cell><code class="text-xs">{k.prefix}…</code></Table.Cell>
                  <Table.Cell><Badge variant="secondary">{t(`settings.key_kind.${k.kind}` as any)}</Badge></Table.Cell>
                  <Table.Cell class="text-xs text-muted-foreground">{k.scopes.join(', ')}{k.last_used_at ? ` · ${t('settings.used', { when: rel(k.last_used_at) })}` : ''}</Table.Cell>
                  <Table.Cell class="text-right"><Button size="sm" variant="ghost" onclick={async () => { if (await confirmAction({ title: t('settings.revoke_key'), description: k.name, confirmLabel: t('settings.revoke'), destructive: true })) run(() => api.del(`/api_keys/${k.id}`), t('settings.key_revoked')); }}>{t('settings.revoke')}</Button></Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
          <Field.Group class="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Field.Field><Field.Label for="kn">{t('field.name')}</Field.Label><Input id="kn" bind:value={newKey.name} /></Field.Field>
            <Field.Field><Field.Label for="kk">{t('field.type')}</Field.Label><NativeSelect.Root id="kk" class="w-full" bind:value={newKey.kind}><NativeSelect.Option value="secret">{t('settings.key_kind.secret')}</NativeSelect.Option><NativeSelect.Option value="publishable">{t('settings.key_kind.publishable')}</NativeSelect.Option></NativeSelect.Root></Field.Field>
            <Button disabled={!newKey.name} onclick={async () => { try { secret = (await api.post('/api_keys', newKey)).key; newKey = { name: '', kind: 'secret' }; load(); } catch (e) { notifyError(e); } }}><PlusIcon />{t('common.create')}</Button>
          </Field.Group>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="team" class="max-w-4xl">
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.tab.team')}</Card.Title><Card.Description>{t('settings.team_hint')}</Card.Description></Card.Header>
        <Card.Content class="flex flex-col gap-4">
          <Table.Root>
            <Table.Body>
              {#each users as u (u.id)}
                <Table.Row>
                  <Table.Cell><div class="font-medium">{u.name || u.email}</div><div class="text-xs text-muted-foreground">{u.email}</div></Table.Cell>
                  <Table.Cell>
                    <NativeSelect.Root size="sm" value={u.role} onchange={(e) => run(() => api.patch(`/users/${u.id}`, { role: (e.target as HTMLSelectElement).value }), t('settings.role_changed'))} aria-label={t('settings.role')}>
                      {#each ['owner', 'admin', 'staff', 'warehouse', 'read_only'] as r}<NativeSelect.Option value={r}>{t(`role.${r}` as any)}</NativeSelect.Option>{/each}
                    </NativeSelect.Root>
                  </Table.Cell>
                  <Table.Cell class="text-right">{#if u.id !== session.me?.user.id}<Button size="sm" variant="ghost" onclick={async () => { if (await confirmAction({ title: t('settings.remove_member'), description: u.email, confirmLabel: t('common.remove'), destructive: true })) run(() => api.del(`/users/${u.id}`), t('common.removed')); }}>{t('common.remove')}</Button>{/if}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
          <Field.Group class="grid gap-3 sm:grid-cols-4 sm:items-end">
            <Field.Field><Field.Label for="ue">{t('field.email')}</Field.Label><Input id="ue" bind:value={newUser.email} /></Field.Field>
            <Field.Field><Field.Label for="un">{t('field.name')}</Field.Label><Input id="un" bind:value={newUser.name} /></Field.Field>
            <Field.Field><Field.Label for="upw">{t('settings.initial_password')}</Field.Label><Input id="upw" type="password" bind:value={newUser.password} /></Field.Field>
            <Field.Field><Field.Label for="ur">{t('settings.role')}</Field.Label><NativeSelect.Root id="ur" class="w-full" bind:value={newUser.role}>{#each ['admin', 'staff', 'warehouse', 'read_only'] as r}<NativeSelect.Option value={r}>{t(`role.${r}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root></Field.Field>
          </Field.Group>
          <div><Button disabled={!newUser.email} onclick={() => run(async () => { await api.post('/users', { ...newUser, password: newUser.password || undefined }); newUser = { email: '', name: '', role: 'staff', password: '' }; }, t('settings.member_added'))}><PlusIcon />{t('settings.add_member')}</Button></div>
          <p class="text-xs text-muted-foreground">{t('settings.member_hint')}</p>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="security" class="max-w-3xl">
      <Card.Root>
        <Card.Header><Card.Title>{t('settings.totp')}</Card.Title><Card.Description>{t('settings.totp_hint')}</Card.Description></Card.Header>
        <Card.Content>
          {#if session.me?.user.totp_enabled}
            <Field.Group>
              <p class="text-sm">{t('settings.totp_on')}</p>
              <Field.Field orientation="horizontal"><Input class="w-36" placeholder={t('settings.current_code')} bind:value={totpCode} aria-label={t('settings.current_code')} /><Button variant="outline" onclick={() => run(async () => { await api.post('/auth/totp/disable', { code: totpCode }); await session.load(); }, t('settings.totp_disabled'))}>{t('common.disable')}</Button></Field.Field>
            </Field.Group>
          {:else if totp}
            <Field.Group>
              <Field.Field><Field.Label for="totp-secret">{t('settings.totp_secret')}</Field.Label><Input id="totp-secret" readonly class="font-mono text-xs" value={totp.secret} /><Field.Description><a class="underline" href={totp.uri}>{t('settings.open_authenticator')}</a></Field.Description></Field.Field>
              <Field.Field orientation="horizontal"><Input class="w-36" inputmode="numeric" placeholder="123456" bind:value={totpCode} aria-label={t('login.totp')} /><Button onclick={() => run(async () => { await api.post('/auth/totp/verify', { code: totpCode }); totp = null; await session.load(); }, t('settings.totp_enabled'))}>{t('settings.verify')}</Button></Field.Field>
            </Field.Group>
          {:else}
            <Button onclick={async () => { try { const r = await api.post('/auth/totp/enroll'); totp = { secret: r.secret, uri: r.otpauth_uri }; } catch (e) { notifyError(e); } }}>{t('settings.totp_setup')}</Button>
          {/if}
        </Card.Content>
      </Card.Root>
    </Tabs.Content>
  </Tabs.Root>

  <Dialog.Root open={!!secret} onOpenChange={(o) => !o && (secret = null)}>
    <Dialog.Content>
      <Dialog.Header><Dialog.Title>{t('settings.secret_title')}</Dialog.Title><Dialog.Description>{t('settings.secret_once')}</Dialog.Description></Dialog.Header>
      <InputGroup.Root><InputGroup.Input readonly class="font-mono text-xs" value={secret ?? ''} /><InputGroup.Addon align="inline-end"><InputGroup.Button size="icon-xs" aria-label={t('common.copy')} onclick={() => secret && copy(secret)}><CopyIcon /></InputGroup.Button></InputGroup.Addon></InputGroup.Root>
      <Dialog.Footer><Button onclick={() => (secret = null)}>{t('common.done')}</Button></Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <Skeleton class="mb-6 h-9 w-full max-w-2xl" /><Skeleton class="h-96 max-w-3xl rounded-xl" />
{/if}
