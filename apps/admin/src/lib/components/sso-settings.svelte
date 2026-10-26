<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Spinner } from '@openrent/ui/spinner';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { api, session, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';

  /** Settings → Single sign-on (FR-USR-4): OpenID Connect providers for staff. */
  type Form = { id: string | null; name: string; issuer: string; client_id: string; client_secret: string; has_secret: boolean; domains: string; default_role: string; enforce_sso: boolean; active: boolean; redirect_uri: string | null };
  let providers = $state<any[]>([]);
  let roles = $state<any[]>([]);
  let form = $state<Form | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const canEdit = $derived(session.can('users:write'));

  async function load() {
    const [p, r] = await Promise.all([api.get('/sso_providers'), api.get('/roles')]);
    providers = p.data;
    roles = r.data.filter((x: any) => x.id !== 'owner');
  }
  onMount(() => {
    load().catch(notifyError);
  });

  function edit(p: any | null) {
    errors = {};
    form = p
      ? { id: p.id, name: p.name, issuer: p.issuer, client_id: p.client_id, client_secret: '', has_secret: p.has_client_secret, domains: p.allowed_domains.join(', '), default_role: p.default_role, enforce_sso: p.enforce_sso, active: p.active, redirect_uri: p.redirect_uri }
      : { id: null, name: '', issuer: 'https://', client_id: '', client_secret: '', has_secret: false, domains: '', default_role: 'read_only', enforce_sso: false, active: true, redirect_uri: null };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    busy = true;
    errors = {};
    const f = form;
    const body: Record<string, unknown> = {
      name: f.name, issuer: f.issuer, client_id: f.client_id, allowed_domains: f.domains.split(/[\s,]+/).filter(Boolean), default_role: f.default_role, enforce_sso: f.enforce_sso, active: f.active,
    };
    // An empty secret field keeps the stored one.
    if (f.client_secret) body.client_secret = f.client_secret;
    try {
      const saved = await (f.id ? api.patch(`/sso_providers/${f.id}`, body) : api.post('/sso_providers', body));
      toast.success(t('common.saved'));
      await load();
      edit(saved);
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!form?.id || !(await confirmAction({ title: t('sso.remove_title', { name: form.name }), description: t('sso.remove_description'), confirmLabel: t('common.remove'), destructive: true }))) return;
    try {
      await api.del(`/sso_providers/${form.id}`);
      form = null;
      await load();
    } catch (err) {
      notifyError(err);
    }
  }
  const domainError = $derived(errors.allowed_domains ?? Object.entries(errors).find(([k]) => k.startsWith('allowed_domains['))?.[1]);
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{t('sso.title')}</Card.Title>
    <Card.Description>{t('sso.hint')}</Card.Description>
    {#if canEdit}<Card.Action><Button size="sm" onclick={() => edit(null)}><PlusIcon />{t('sso.new')}</Button></Card.Action>{/if}
  </Card.Header>
  <Card.Content>
    <Table.Root>
      <Table.Body>
        {#each providers as p (p.id)}
          <Table.Row class="cursor-pointer" data-testid="sso-row" onclick={() => canEdit && edit(p)}>
            <Table.Cell class="font-medium">{p.name}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{p.allowed_domains.join(', ')}</Table.Cell>
            <Table.Cell class="text-right">
              {#if !p.active}<Badge variant="secondary">{t('sso.off')}</Badge>{:else if p.enforce_sso}<Badge variant="outline">{t('sso.enforced')}</Badge>{/if}
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell class="text-muted-foreground">{t('sso.none')}</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </Card.Content>
</Card.Root>

<Sheet.Root open={!!form} onOpenChange={(v) => !v && (form = null)}>
  <Sheet.Content class="overflow-y-auto sm:max-w-lg">
    {#if form}
      <form class="flex flex-col gap-4 p-4" onsubmit={save} novalidate>
        <Sheet.Header class="p-0"><Sheet.Title>{form.id ? form.name : t('sso.new')}</Sheet.Title><Sheet.Description>{t('sso.editor_hint')}</Sheet.Description></Sheet.Header>
        <Field.Group>
          {#if form.redirect_uri}
            <Field.Field>
              <Field.Label for="sso-redirect">{t('sso.redirect_uri')}</Field.Label>
              <div class="flex gap-2">
                <Input id="sso-redirect" readonly value={form.redirect_uri} class="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" aria-label={t('sso.copy')} onclick={() => navigator.clipboard.writeText(form!.redirect_uri!).then(() => toast.success(t('sso.copied')))}><CopyIcon /></Button>
              </div>
              <Field.Description>{t('sso.redirect_hint')}</Field.Description>
            </Field.Field>
          {/if}
          {#each [['name', 'sso.name', 'text'], ['issuer', 'sso.issuer', 'url'], ['client_id', 'sso.client_id', 'text']] as [k, label, type] (k)}
            <Field.Field data-invalid={!!errors[k] || undefined}>
              <Field.Label for={`sso-${k}`}>{t(label as any)}</Field.Label>
              <Input id={`sso-${k}`} {type} bind:value={form[k as 'name']} aria-invalid={!!errors[k]} />
              {#if errors[k]}<Field.Error>{errors[k]}</Field.Error>{/if}
            </Field.Field>
          {/each}
          <Field.Field>
            <Field.Label for="sso-secret">{t('sso.client_secret')}</Field.Label>
            <Input id="sso-secret" type="password" autocomplete="off" placeholder={form.has_secret ? t('sso.secret_kept') : ''} bind:value={form.client_secret} />
            <Field.Description>{t('sso.secret_hint')}</Field.Description>
          </Field.Field>
          <Field.Field data-invalid={!!domainError || undefined}>
            <Field.Label for="sso-domains">{t('sso.domains')}</Field.Label>
            <Input id="sso-domains" placeholder="example.com" bind:value={form.domains} aria-invalid={!!domainError} />
            {#if domainError}<Field.Error>{domainError}</Field.Error>{:else}<Field.Description>{t('sso.domains_hint')}</Field.Description>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!errors.default_role || undefined}>
            <Field.Label for="sso-role">{t('sso.default_role')}</Field.Label>
            <NativeSelect.Root id="sso-role" class="w-full" bind:value={form.default_role}>{#each roles as r (r.id)}<NativeSelect.Option value={r.id}>{r.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
            {#if errors.default_role}<Field.Error>{errors.default_role}</Field.Error>{:else}<Field.Description>{t('sso.default_role_hint')}</Field.Description>{/if}
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch id="sso-enforce" bind:checked={form.enforce_sso} />
            <Field.Content><Field.Label for="sso-enforce" class="font-normal">{t('sso.enforce')}</Field.Label><Field.Description>{t('sso.enforce_hint')}</Field.Description></Field.Content>
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch id="sso-active" bind:checked={form.active} />
            <Field.Label for="sso-active" class="font-normal">{t('sso.active')}</Field.Label>
          </Field.Field>
        </Field.Group>
        <Sheet.Footer class="flex-row justify-between p-0">
          {#if form.id}<Button type="button" variant="ghost" onclick={remove}>{t('common.remove')}</Button>{:else}<span></span>{/if}
          <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('common.save')}</Button>
        </Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
