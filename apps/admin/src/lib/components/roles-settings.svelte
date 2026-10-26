<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Table from '@openrent/ui/table';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Spinner } from '@openrent/ui/spinner';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { api, session, t, toast, notifyError, fieldErrors, confirmAction } from '#lib';

  /** Roles with a permission matrix (FR-USR-3). Built-in roles are shown read-only; owners add their own. */
  let { onchange }: { onchange?: () => void } = $props();
  let roles = $state<any[]>([]);
  let all = $state<string[]>([]);
  let form = $state<{ id: string | null; name: string; description: string; permissions: string[]; system: boolean } | null>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const isOwner = $derived(session.me?.role === 'owner');
  // Rows of the matrix: each resource with the actions it has.
  const resources = $derived([...new Set(all.map((p) => p.split(':')[0]!))].map((r) => ({ resource: r, actions: all.filter((p) => p.startsWith(`${r}:`)) })));

  async function load() {
    const r = await api.get('/roles');
    roles = r.data;
    all = r.permissions;
  }
  onMount(() => {
    load().catch(notifyError);
  });

  const grants = (role: { permissions: string[] }, p: string) => role.permissions.includes('*') || role.permissions.includes(p);
  function edit(r: any | null) {
    errors = {};
    form = r ? { id: r.id, name: r.name, description: r.description, permissions: r.permissions.includes('*') ? [...all] : [...r.permissions], system: r.system } : { id: null, name: '', description: '', permissions: [], system: false };
  }
  function toggle(p: string, on: boolean) {
    if (!form) return;
    form.permissions = on ? [...new Set([...form.permissions, p])] : form.permissions.filter((x) => x !== p);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!form || form.system) return;
    busy = true;
    errors = {};
    const body = { name: form.name, description: form.description, permissions: all.filter((p) => form!.permissions.includes(p)) };
    try {
      await (form.id ? api.patch(`/roles/${form.id}`, body) : api.post('/roles', body));
      toast.success(t('common.saved'));
      form = null;
      await load();
      onchange?.();
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!form?.id || !(await confirmAction({ title: t('roles.delete_title', { name: form.name }), description: t('roles.delete_description'), confirmLabel: t('common.remove'), destructive: true }))) return;
    try {
      await api.del(`/roles/${form.id}`);
      form = null;
      await load();
      onchange?.();
    } catch (err) {
      notifyError(err);
    }
  }
  const label = (p: string) => t(`permission.${p.replace(':', '.')}` as any);
</script>

<Card.Root class="mt-6">
  <Card.Header>
    <Card.Title>{t('roles.title')}</Card.Title>
    <Card.Description>{isOwner ? t('roles.hint') : t('roles.hint_not_owner')}</Card.Description>
    {#if isOwner}<Card.Action><Button size="sm" onclick={() => edit(null)}><PlusIcon />{t('roles.new')}</Button></Card.Action>{/if}
  </Card.Header>
  <Card.Content>
    <Table.Root>
      <Table.Body>
        {#each roles as r (r.id)}
          <Table.Row class="cursor-pointer" data-testid="role-row" onclick={() => edit(r)}>
            <Table.Cell class="font-medium">{r.name} {#if r.system}<Badge variant="secondary" class="ml-1">{t('roles.built_in')}</Badge>{/if}</Table.Cell>
            <Table.Cell class="text-muted-foreground">{r.description}</Table.Cell>
            <Table.Cell class="text-muted-foreground text-right tabular-nums">{t('roles.members', { count: r.members })}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </Card.Content>
</Card.Root>

<Sheet.Root open={!!form} onOpenChange={(v) => !v && (form = null)}>
  <Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
    {#if form}
      <form class="flex flex-col gap-5 p-4" onsubmit={save} novalidate>
        <Sheet.Header class="p-0">
          <Sheet.Title>{form.id ? form.name : t('roles.new')}</Sheet.Title>
          <Sheet.Description>{form.system ? t('roles.built_in_hint') : t('roles.editor_hint')}</Sheet.Description>
        </Sheet.Header>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="role-name">{t('field.name')}</Field.Label>
            <Input id="role-name" bind:value={form.name} readonly={form.system || !isOwner} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          <Field.Field>
            <Field.Label for="role-desc">{t('field.description')}</Field.Label>
            <Textarea id="role-desc" bind:value={form.description} readonly={form.system || !isOwner} />
          </Field.Field>
          <Field.Set>
            <Field.Legend variant="label">{t('roles.permissions')}</Field.Legend>
            <Table.Root data-testid="permission-matrix">
              <Table.Body>
                {#each resources as row (row.resource)}
                  <Table.Row>
                    <Table.Cell class="font-medium">{t(`permission.${row.resource}` as any)}</Table.Cell>
                    <Table.Cell>
                      <div class="flex flex-wrap gap-x-4 gap-y-2">
                        {#each row.actions as p (p)}
                          <Field.Field orientation="horizontal" class="w-auto">
                            <Checkbox id={`perm-${p}`} checked={grants(form, p)} disabled={form.system || !isOwner} onCheckedChange={(v) => toggle(p, v === true)} />
                            <Field.Label for={`perm-${p}`} class="font-normal">{label(p)}</Field.Label>
                          </Field.Field>
                        {/each}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </Field.Set>
        </Field.Group>
        {#if !form.system && isOwner}
          <Sheet.Footer class="flex-row justify-between p-0">
            {#if form.id}<Button type="button" variant="ghost" onclick={remove}>{t('common.remove')}</Button>{:else}<span></span>{/if}
            <Button type="submit" disabled={busy}>{#if busy}<Spinner />{/if}{t('common.save')}</Button>
          </Sheet.Footer>
        {/if}
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
