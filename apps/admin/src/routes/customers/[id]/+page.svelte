<script lang="ts">
  import PluginSlot from '#lib/components/plugin-slot.svelte';
  import { page } from '$app/state';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Switch } from '@openrent/ui/switch';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { StatusBadge, Money, PageHeader, StatCard, formatMoney } from '@openrent/ui/openrent';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { api, t, toast, notifyError, fieldErrors, confirmAction, d, rel, session } from '#lib';
  import { LOCALES } from '@openrent/i18n';
  import { to } from '#lib/nav.ts';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as Dialog from '@openrent/ui/dialog';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import AuditHistory from '#lib/components/audit-history.svelte';
  import AttachmentsCard from '#lib/components/attachments-card.svelte';
  import TagInput from '#lib/components/tag-input.svelte';
  import CustomFieldsForm from '#lib/components/custom-fields-form.svelte';
  import CustomerTermsCard from '#lib/components/customer-terms-card.svelte';
  import CustomerBillingCard from '#lib/components/customer-billing-card.svelte';

  const ADDRESS_FIELDS = ['line1', 'line2', 'postal_code', 'city', 'country'] as const;
  const blankAddress = () => Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, ''])) as Record<string, string>;
  let addr = $state<{ billing: Record<string, string>; shipping: Record<string, string> }>({ billing: blankAddress(), shipping: blankAddress() });
  let contacts = $state<any[]>([]);
  let contactOpen = $state(false);
  let contact = $state<any>({});
  let contactErrors = $state<Record<string, string>>({});

  const id = $derived(page.params.id!);
  let c = $state<any>(null);
  let orders = $state<any[]>([]);
  let f = $state<any>({});
  let errors = $state<Record<string, string>>({});
  let mergeId = $state('');

  async function load() {
    c = await api.get(`/customers/${id}`);
    f = { type: c.type, name: c.name, email: c.email ?? '', phone: c.phone ?? '', company_name: c.company_name ?? '', tax_id: c.tax_id ?? '', locale: c.locale ?? '', notes: c.notes, tags: [...c.tags], custom_fields: { ...(c.custom_fields ?? {}) } };
    addr = { billing: { ...blankAddress(), ...(c.addresses?.billing ?? {}) }, shipping: { ...blankAddress(), ...(c.addresses?.shipping ?? {}) } };
    orders = (await api.get(`/customers/${id}/orders?limit=100`)).data;
    contacts = (await api.get(`/customers/${id}/contacts`)).data;
    sessions = (await api.get(`/customers/${id}/sessions`)).data;
  }
  let sessions = $state<any[]>([]);
  $effect(() => {
    void id;
    load().catch(notifyError);
  });

  async function run(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      await load();
    } catch (e) {
      errors = fieldErrors(e);
      if (!Object.keys(errors).length) notifyError(e);
    }
  }
  const save = () =>
    run(
      () =>
        api.patch(`/customers/${id}`, {
          type: f.type, name: f.name, email: f.email || null, phone: f.phone || null, company_name: f.company_name || null, tax_id: f.tax_id || null, locale: f.locale || null,
          notes: f.notes, tags: f.tags, custom_fields: f.custom_fields,
        }),
      t('common.saved'),
    );
  const clean = (a: Record<string, string>) => {
    const out = Object.fromEntries(Object.entries(a).filter(([, v]) => v.trim()).map(([k, v]) => [k, k === 'country' ? v.trim().toUpperCase() : v.trim()]));
    return Object.keys(out).length ? out : null;
  };
  const checkTaxId = () => run(() => api.post(`/customers/${id}/actions/check_tax_id`, {}), t('customer.tax_check.done'));
  const saveAddresses = () => run(() => api.patch(`/customers/${id}`, { addresses: { billing: clean(addr.billing), shipping: clean(addr.shipping) } }), t('common.saved'));

  function editContact(x?: any) {
    contactErrors = {};
    contact = x ? { ...x, email: x.email ?? '', phone: x.phone ?? '', role: x.role ?? '' } : { name: '', email: '', phone: '', role: '', is_primary: contacts.length === 0 };
    contactOpen = true;
  }
  async function saveContact(e: SubmitEvent) {
    e.preventDefault();
    contactErrors = {};
    const body = { name: contact.name, email: contact.email || null, phone: contact.phone || null, role: contact.role || null, is_primary: !!contact.is_primary };
    try {
      if (contact.id) await api.patch(`/customers/${id}/contacts/${contact.id}`, body);
      else await api.post(`/customers/${id}/contacts`, body);
      contactOpen = false;
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      contactErrors = fieldErrors(err);
      if (!Object.keys(contactErrors).length) notifyError(err);
    }
  }
  async function removeContact(x: any) {
    if (await confirmAction({ title: t('customer.contact_remove', { name: x.name }), description: t('customer.contact_remove_hint'), confirmLabel: t('common.remove'), destructive: true })) await run(() => api.del(`/customers/${id}/contacts/${x.id}`), t('common.removed'));
  }
  const flag = (k: string, v: boolean) => run(() => api.patch(`/customers/${id}`, { flags: { [k]: v } }), t('common.saved'));

  async function exportData() {
    try {
      const data = await api.get(`/customers/${id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `customer-${id}.json` }).click();
    } catch (e) {
      notifyError(e);
    }
  }
  async function merge() {
    if (await confirmAction({ title: t('customer.merge_title'), description: t('customer.merge_description'), confirmLabel: t('customer.merge') })) await run(() => api.post(`/customers/${id}/actions/merge`, { source_id: mergeId }), t('customer.toast.merged'));
  }
  async function anonymize() {
    if (await confirmAction({ title: t('customer.anonymize_title'), description: t('customer.anonymize_description'), confirmLabel: t('customer.anonymize'), destructive: true })) await run(() => api.post(`/customers/${id}/actions/anonymize`), t('customer.toast.anonymized'));
  }
</script>

<svelte:head><title>{c?.name ?? t('nav.customers')} · OpenRent</title></svelte:head>

{#if c}
  <PageHeader title={c.name} description={[c.email, c.phone].filter(Boolean).join(' · ')}>
    {#if c.flags.blocked}<StatusBadge status="blocked" label={t('customer.flag.blocked')} />{/if}
    {#if c.anonymized_at}<StatusBadge status="closed" label={t('customer.anonymized')} />{/if}
    {#snippet actions()}
      <Button variant="outline" onclick={() => run(() => api.post(`/customers/${id}/actions/${c.flags.blocked ? 'unblock' : 'block'}`, {}), c.flags.blocked ? t('customer.toast.unblocked') : t('customer.toast.blocked'))}>{c.flags.blocked ? t('customer.unblock') : t('customer.block')}</Button>
      <Button href={to('/orders/new')}><PlusIcon />{t('action.new_order')}</Button>
    {/snippet}
  </PageHeader>
  <div class="mb-6 grid grid-cols-3 gap-4">
    <StatCard label={t('nav.orders')} value={c.stats.orders} />
    <StatCard label={t('customer.lifetime_value')} value={formatMoney({ amount: c.stats.lifetime_value, currency: orders[0]?.currency ?? 'EUR' })} />
    <StatCard label={t('customer.damage_incidents')} value={c.stats.damage_incidents} />
  </div>
  <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
    <div class="flex min-w-0 flex-col gap-6">
    <Card.Root>
      <Card.Header><Card.Title>{t('nav.orders')}</Card.Title></Card.Header>
      <Card.Content>
        <Table.Root>
          <Table.Body>
            {#each orders as o (o.id)}
              <Table.Row>
                <Table.Cell class="font-mono text-xs"><a href={to(`/orders/${o.id}`)} class="hover:underline">#{o.number}</a></Table.Cell>
                <Table.Cell>{d(o.starts_at)} – {d(o.ends_at)}</Table.Cell>
                <Table.Cell><StatusBadge status={o.status} label={t(`status.${o.status}` as any)} /></Table.Cell>
                <Table.Cell class="text-right"><Money value={o.totals.total} /></Table.Cell>
              </Table.Row>
            {:else}
              <Table.Row><Table.Cell class="h-20 text-center text-muted-foreground">{t('customer.no_orders')}</Table.Cell></Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header><Card.Title>{t('customer.addresses')}</Card.Title><Card.Description>{t('customer.addresses_hint')}</Card.Description></Card.Header>
      <Card.Content class="grid gap-6 md:grid-cols-2">
        {#each ['billing', 'shipping'] as kind (kind)}
          <Field.Set>
            <Field.Legend variant="label">{t(`customer.address.${kind}` as any)}</Field.Legend>
            <Field.Group class="gap-3">
              {#each ADDRESS_FIELDS as k (k)}
                <Field.Field data-invalid={!!errors[`addresses.${kind}.${k}`] || undefined}>
                  <Field.Label for={`${kind}-${k}`} class="text-xs">{t(`customer.address.${k}` as any)}</Field.Label>
                  <Input id={`${kind}-${k}`} maxlength={k === 'country' ? 2 : 200} bind:value={addr[kind as 'billing' | 'shipping'][k]} />
                </Field.Field>
              {/each}
            </Field.Group>
          </Field.Set>
        {/each}
      </Card.Content>
      <Card.Footer><Button onclick={saveAddresses}>{t('common.save')}</Button></Card.Footer>
    </Card.Root>
    <CustomerBillingCard customerId={c.id} />
    {#if f.type === 'company' || contacts.length}
      <Card.Root data-testid="customer-contacts">
        <Card.Header>
          <Card.Title>{t('customer.contacts')}</Card.Title>
          <Card.Description>{t('customer.contacts_hint')}</Card.Description>
          <Card.Action><Button size="sm" variant="outline" onclick={() => editContact()}><PlusIcon />{t('customer.contact_add')}</Button></Card.Action>
        </Card.Header>
        <Card.Content>
          {#if contacts.length}
            <Table.Root>
              <Table.Body>
                {#each contacts as x (x.id)}
                  <Table.Row>
                    <Table.Cell><div class="font-medium">{x.name} {#if x.is_primary}<Badge variant="secondary" class="ml-1">{t('customer.contact_primary')}</Badge>{/if}</div>{#if x.role}<div class="text-muted-foreground text-xs">{x.role}</div>{/if}</Table.Cell>
                    <Table.Cell class="text-muted-foreground">{[x.email, x.phone].filter(Boolean).join(' · ')}</Table.Cell>
                    <Table.Cell class="w-24 text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={t('common.edit')} onclick={() => editContact(x)}><PencilIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onclick={() => removeContact(x)}><Trash2Icon /></Button>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          {:else}<p class="text-muted-foreground text-sm">{t('customer.contacts_empty')}</p>{/if}
        </Card.Content>
      </Card.Root>
    {/if}
    </div>
    <div class="flex flex-col gap-6">
      <Card.Root>
        <Card.Header><Card.Title>{t('common.details')}</Card.Title></Card.Header>
        <Card.Content>
          <Field.Group>
            <Field.Field>
              <Field.Label for="ctype">{t('customer.type')}</Field.Label>
              <NativeSelect.Root id="ctype" class="w-full" bind:value={f.type}>{#each ['person', 'company'] as x (x)}<NativeSelect.Option value={x}>{t(`customer.type.${x}` as any)}</NativeSelect.Option>{/each}</NativeSelect.Root>
            </Field.Field>
            {#each [['name', 'field.name'], ['email', 'field.email'], ['phone', 'field.phone'], ['company_name', 'customers.company'], ['tax_id', 'field.tax_id']] as [k, l] (k)}
              <Field.Field data-invalid={!!errors[k] || undefined}>
                <Field.Label for={k}>{t(l as any)}</Field.Label>
                <Input id={k} bind:value={f[k]} />
                {#if errors[k]}<Field.Error>{errors[k]}</Field.Error>{/if}
                {#if k === 'tax_id' && c.tax_id_check && c.tax_id && f.tax_id === c.tax_id}
                  {@const chk = c.tax_id_check}
                  <div class="flex flex-col gap-1 text-sm" data-testid="tax-id-check">
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge variant={chk.status === 'valid' ? 'secondary' : chk.status === 'invalid' ? 'destructive' : 'outline'}>{t(`customer.tax_check.${chk.status}` as any)}</Badge>
                      <span class="text-muted-foreground">{t('customer.tax_check.checked', { date: d(chk.checked_at) })}</span>
                      {#if session.can('customers:write')}<Button variant="link" size="sm" class="h-auto p-0" onclick={checkTaxId}>{t('customer.tax_check.again')}</Button>{/if}
                    </div>
                    {#if chk.name}<span class="text-muted-foreground whitespace-pre-line">{chk.name}{#if chk.address}<br />{chk.address}{/if}</span>{/if}
                    {#if chk.ref}<span class="text-muted-foreground">{t('customer.tax_check.ref', { ref: chk.ref })}</span>{/if}
                  </div>
                {/if}
              </Field.Field>
            {/each}
            <Field.Field>
              <Field.Label for="clocale">{t('customer.language')}</Field.Label>
              <NativeSelect.Root id="clocale" class="w-full" bind:value={f.locale}>
                <NativeSelect.Option value="">{t('customer.language_default')}</NativeSelect.Option>
                {#each LOCALES as l (l)}<NativeSelect.Option value={l}>{t(`language.${l}` as any)}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
              <Field.Description>{t('customer.language_hint')}</Field.Description>
            </Field.Field>
            <Field.Field><Field.Label for="ctags">{t('customer.tags')}</Field.Label><TagInput id="ctags" entity="customer" bind:value={f.tags} /></Field.Field>
            <CustomFieldsForm entity="customer" bind:value={f.custom_fields} {errors} />
            <Field.Field><Field.Label for="notes">{t('order.notes')}</Field.Label><Textarea id="notes" bind:value={f.notes} /></Field.Field>
            <Field.Separator />
            <Field.Field orientation="horizontal"><Field.Label for="fw" class="flex-1 font-normal">{t('customer.flag.deposit_waived')}</Field.Label><Switch id="fw" checked={c.flags.deposit_waived} onCheckedChange={(v) => flag('deposit_waived', v)} /></Field.Field>
            <Field.Field orientation="horizontal"><Field.Label for="fi" class="flex-1 font-normal">{t('customer.flag.id_check')}</Field.Label><Switch id="fi" checked={c.flags.requires_id_check} onCheckedChange={(v) => flag('requires_id_check', v)} /></Field.Field>
            {#if c.flags.requires_id_check}<Field.Field orientation="horizontal"><Field.Label for="fv" class="flex-1 font-normal">{t('customer.flag.id_verified')}</Field.Label><Switch id="fv" checked={c.flags.id_verified} onCheckedChange={(v) => flag('id_verified', v)} /></Field.Field>{/if}
            <Field.Field orientation="horizontal"><Field.Label for="mc" class="flex-1 font-normal">{t('customer.marketing_consent')}</Field.Label><Switch id="mc" checked={c.marketing_consent} onCheckedChange={(v) => run(() => api.patch(`/customers/${id}`, { marketing_consent: v }), t('common.saved'))} /></Field.Field>
            <Field.Field orientation="horizontal"><Field.Label for="sms-in" class="flex-1 font-normal">{t('customer.sms_opt_in')}</Field.Label><Switch id="sms-in" checked={c.sms_opt_in} onCheckedChange={(v) => run(() => api.patch(`/customers/${id}`, { sms_opt_in: v }), t('common.saved'))} /></Field.Field>
            <Field.Field orientation="horizontal"><Field.Label for="wa-in" class="flex-1 font-normal">{t('customer.whatsapp_opt_in')}</Field.Label><Switch id="wa-in" checked={c.whatsapp_opt_in} onCheckedChange={(v) => run(() => api.patch(`/customers/${id}`, { whatsapp_opt_in: v }), t('common.saved'))} /></Field.Field>
          </Field.Group>
        </Card.Content>
        <Card.Footer><Button onclick={save}>{t('common.save')}</Button></Card.Footer>
      </Card.Root>
      <CustomerTermsCard customer={c} onsaved={() => load().catch(notifyError)} />
      <Card.Root data-testid="customer-account">
        <Card.Header><Card.Title>{t('customer.account.title')}</Card.Title><Card.Description>{t('customer.account.description')}</Card.Description></Card.Header>
        <Card.Content class="flex flex-col gap-3 text-sm">
          {#each sessions as s (s.id)}
            <p>{t('customer.account.session', { when: rel(s.created_at), seen: rel(s.last_seen_at ?? s.created_at) })}</p>
          {:else}
            <p class="text-muted-foreground">{t('customer.account.none')}</p>
          {/each}
          {#if sessions.length && session.can('customers:write')}
            <Button variant="outline" class="w-fit" onclick={() => run(() => api.del(`/customers/${id}/sessions`), t('customer.account.signed_out'))}>{t('customer.account.sign_out')}</Button>
          {/if}
          {#if c.email && session.can('customers:write')}
            <div class="flex flex-col gap-1">
              <Button variant="outline" class="w-fit" onclick={() => run(() => api.post(`/customers/${id}/actions/send_portal_link`), t('customer.account.link_sent', { email: c.email }))}>{t('customer.account.send_link')}</Button>
              <p class="text-xs text-muted-foreground">{t('customer.account.send_link_hint')}</p>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header><Card.Title>{t('customer.privacy')}</Card.Title><Card.Description>{t('customer.privacy_hint')}</Card.Description></Card.Header>
        <Card.Content class="flex flex-col gap-3">
          <Button variant="outline" class="w-fit" onclick={exportData}><DownloadIcon />{t('customer.export')}</Button>
          <div class="flex gap-2"><Input placeholder="cus_…" bind:value={mergeId} aria-label={t('customer.merge_id')} /><Button variant="outline" disabled={!mergeId} onclick={merge}>{t('customer.merge')}</Button></div>
          <Button variant="destructive" class="w-fit" onclick={anonymize}>{t('customer.anonymize')}</Button>
        </Card.Content>
      </Card.Root>
      <AttachmentsCard ownerPath={`/customers/${c.id}`} />
      <AuditHistory entityType="customer" entityId={c.id} />
      <PluginSlot slot="customer.tab" context={{ customer_id: c.id }} />
    </div>
  </div>

  <Dialog.Root bind:open={contactOpen}>
    <Dialog.Content>
      <form class="flex flex-col gap-4" onsubmit={saveContact}>
        <Dialog.Header><Dialog.Title>{contact.id ? t('customer.contact_edit') : t('customer.contact_add')}</Dialog.Title></Dialog.Header>
        <Field.Group>
          {#each [['name', 'field.name'], ['email', 'field.email'], ['phone', 'field.phone'], ['role', 'customer.contact_role']] as [k, l] (k)}
            <Field.Field data-invalid={!!contactErrors[k] || undefined}>
              <Field.Label for={`ct-${k}`}>{t(l as any)}</Field.Label>
              <Input id={`ct-${k}`} type={k === 'email' ? 'email' : 'text'} required={k === 'name'} bind:value={contact[k]} aria-invalid={!!contactErrors[k]} />
              {#if contactErrors[k]}<Field.Error>{contactErrors[k]}</Field.Error>{/if}
            </Field.Field>
          {/each}
          <Field.Field orientation="horizontal"><Checkbox id="ct-primary" bind:checked={contact.is_primary} /><Field.Label for="ct-primary" class="font-normal">{t('customer.contact_primary_label')}</Field.Label></Field.Field>
        </Field.Group>
        <Dialog.Footer><Button type="submit">{t('common.save')}</Button></Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <Skeleton class="mb-6 h-10 w-72" /><Skeleton class="h-96 rounded-xl" />
{/if}
