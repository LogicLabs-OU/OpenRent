<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import * as DropdownMenu from '@openrent/ui/dropdown-menu';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import { api, session, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';
  import RolesSettings from './roles-settings.svelte';

  /** Settings → Team: members, their role (built-in or the shop's own) and their access (FR-USR-3). */
  let users = $state<any[]>([]);
  let roles = $state<any[]>([]);
  let newUser = $state({ email: '', name: '', role: 'staff', password: '' });
  let errors = $state<Record<string, string>>({});
  const isOwner = $derived(session.me?.role === 'owner');

  async function load() {
    const [u, r] = await Promise.all([api.get('/users'), api.get('/roles')]);
    users = u.data;
    roles = r.data;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
  const roleValue = (u: any) => u.role_id ?? u.role;
  const assignable = $derived(roles.filter((r) => isOwner || (r.system && r.id !== 'owner')));

  async function add(e: SubmitEvent) {
    e.preventDefault();
    errors = {};
    try {
      await api.post('/users', { ...newUser, password: newUser.password || undefined });
      newUser = { email: '', name: '', role: 'staff', password: '' };
      toast.success(t('settings.member_added'));
      await load();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    }
  }
  async function remove(u: any) {
    if (await confirmAction({ title: t('settings.remove_member'), description: u.email, confirmLabel: t('common.remove'), destructive: true })) run(() => api.del(`/users/${u.id}`), t('common.removed'));
  }
</script>

<Card.Root>
  <Card.Header><Card.Title>{t('settings.tab.team')}</Card.Title><Card.Description>{t('settings.team_hint')}</Card.Description></Card.Header>
  <Card.Content class="flex flex-col gap-4">
    <Table.Root>
      <Table.Body>
        {#each users as u (u.id)}
          <Table.Row data-testid="member-row">
            <Table.Cell>
              <div class="font-medium">{u.name || u.email}</div>
              <div class="text-muted-foreground text-xs">{u.email}</div>
            </Table.Cell>
            <Table.Cell>
              <NativeSelect.Root size="sm" value={roleValue(u)} disabled={u.role === 'owner' && !isOwner} onchange={(e) => run(() => api.patch(`/users/${u.id}`, { role: (e.target as HTMLSelectElement).value }), t('settings.role_changed'))} aria-label={t('settings.role_of', { name: u.name || u.email })}>
                {#each roles.filter((r) => r.id === roleValue(u) || assignable.includes(r)) as r (r.id)}<NativeSelect.Option value={r.id}>{r.name}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
            </Table.Cell>
            <Table.Cell>{#if u.status === 'disabled'}<Badge variant="secondary">{t('team.disabled')}</Badge>{:else if !u.has_password}<Badge variant="outline">{t('team.no_password')}</Badge>{/if}</Table.Cell>
            <Table.Cell class="text-right">
              {#if u.id !== session.me?.user.id}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>{#snippet child({ props })}<Button {...props} size="icon-sm" variant="ghost" aria-label={t('team.actions_for', { name: u.name || u.email })}><EllipsisIcon /></Button>{/snippet}</DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    {#if u.status !== 'disabled'}
                      <DropdownMenu.Item onSelect={() => run(() => api.post(`/users/${u.id}/actions/invite`, {}), t('team.link_sent', { email: u.email }))}>{t('team.send_invitation')}</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={async () => { if (await confirmAction({ title: t('team.reset_title'), description: t('team.reset_description', { email: u.email }), confirmLabel: t('team.reset') })) run(() => api.post(`/users/${u.id}/actions/reset_password`, {}), t('team.link_sent', { email: u.email })); }}>{t('team.reset')}</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => run(() => api.post(`/users/${u.id}/actions/disable`, {}), t('team.disabled_toast', { name: u.name || u.email }))}>{t('team.disable')}</DropdownMenu.Item>
                    {:else}
                      <DropdownMenu.Item onSelect={() => run(() => api.post(`/users/${u.id}/actions/enable`, {}), t('team.enabled_toast', { name: u.name || u.email }))}>{t('team.enable')}</DropdownMenu.Item>
                    {/if}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item variant="destructive" onSelect={() => remove(u)}>{t('common.remove')}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
    <form class="flex flex-col gap-3" onsubmit={add} novalidate>
      <Field.Group class="grid gap-3 sm:grid-cols-4 sm:items-start">
        <Field.Field data-invalid={!!errors.email || undefined}>
          <Field.Label for="ue">{t('field.email')}</Field.Label>
          <Input id="ue" type="email" bind:value={newUser.email} aria-invalid={!!errors.email} />
          {#if errors.email}<Field.Error>{errors.email}</Field.Error>{/if}
        </Field.Field>
        <Field.Field><Field.Label for="un">{t('field.name')}</Field.Label><Input id="un" bind:value={newUser.name} /></Field.Field>
        <Field.Field><Field.Label for="upw">{t('settings.initial_password')}</Field.Label><Input id="upw" type="password" bind:value={newUser.password} /></Field.Field>
        <Field.Field data-invalid={!!errors.role || undefined}>
          <Field.Label for="ur">{t('settings.role')}</Field.Label>
          <NativeSelect.Root id="ur" class="w-full" bind:value={newUser.role}>{#each assignable.filter((r) => r.id !== 'owner') as r (r.id)}<NativeSelect.Option value={r.id}>{r.name}</NativeSelect.Option>{/each}</NativeSelect.Root>
          {#if errors.role}<Field.Error>{errors.role}</Field.Error>{/if}
        </Field.Field>
      </Field.Group>
      <div><Button type="submit" disabled={!newUser.email}><PlusIcon />{t('settings.add_member')}</Button></div>
      <p class="text-muted-foreground text-xs">{t('settings.member_hint')}</p>
    </form>
  </Card.Content>
</Card.Root>

<RolesSettings onchange={load} />
