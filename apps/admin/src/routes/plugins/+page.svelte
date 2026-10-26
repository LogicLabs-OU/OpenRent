<script lang="ts">
  import PluginSlot from '#lib/components/plugin-slot.svelte';
  import PluginInstall from '#lib/components/plugin-install.svelte';
  import * as Card from '@openrent/ui/card';
  import * as Sheet from '@openrent/ui/sheet';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import * as Table from '@openrent/ui/table';
  import * as Empty from '@openrent/ui/empty';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Switch } from '@openrent/ui/switch';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Spinner } from '@openrent/ui/spinner';
  import { PageHeader, StatusBadge } from '@openrent/ui/openrent';
  import PuzzleIcon from '@lucide/svelte/icons/puzzle';
  import SettingsIcon from '@lucide/svelte/icons/settings-2';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';
  import EmailDelivery from '#lib/components/email-delivery.svelte';

  interface SettingsField {
    key: string;
    label: string;
    type: 'text' | 'secret' | 'boolean' | 'select' | 'number';
    options?: string[];
    required?: boolean;
    help?: string;
  }
  interface Plugin {
    id: string;
    name: string;
    version: string;
    compat: string;
    state: 'loaded' | 'errored' | 'incompatible' | 'disabled';
    error: string | null;
    permissions: string[];
    provides: string[];
    warnings: string[];
    jobs: { name: string; cron: string }[];
    enabled: boolean;
    settings: SettingsField[];
    values: Record<string, unknown>;
    secrets: Record<string, 'tenant' | 'installation' | null>;
  }

  let plugins = $state<Plugin[] | null>(null);
  let hookErrors = $state<{ pluginId: string; hook: string; error: string; at: string }[]>([]);
  let installAllowed = $state(false);
  let editing = $state<Plugin | null>(null);
  let form = $state<Record<string, unknown>>({});
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  async function load() {
    try {
      const r = await api.get('/plugins');
      plugins = r.data;
      hookErrors = r.hook_errors ?? [];
      installAllowed = !!r.install_allowed;
    } catch (e) {
      notifyError(e);
    }
  }
  load();

  const replace = (p: Plugin) => (plugins = plugins?.map((x) => (x.id === p.id ? p : x)) ?? null);

  async function toggle(p: Plugin, enabled: boolean) {
    try {
      replace(await api.patch(`/plugins/${p.id}`, { enabled }));
      toast.success(enabled ? t('plugins.enabled_toast', { name: p.name }) : t('plugins.disabled_toast', { name: p.name }));
    } catch (e) {
      notifyError(e);
      await load();
    }
  }

  function configure(p: Plugin) {
    editing = p;
    errors = {};
    // Secrets start empty: typing replaces the stored value, leaving them empty keeps it.
    form = Object.fromEntries(p.settings.map((f) => [f.key, f.type === 'secret' ? '' : (p.values[f.key] ?? (f.type === 'boolean' ? false : ''))]));
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!editing) return;
    saving = true;
    errors = {};
    const config: Record<string, unknown> = {};
    for (const f of editing.settings) {
      const v = form[f.key];
      if (f.type === 'secret') {
        if (v) config[f.key] = v;
      } else if (f.type === 'number') config[f.key] = v === '' || v === null ? null : Number(v);
      else config[f.key] = v === '' ? null : v;
    }
    try {
      const p = await api.patch(`/plugins/${editing.id}`, { config });
      replace(p);
      editing = null;
      toast.success(t('common.saved'));
    } catch (err) {
      errors = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [k.replace(/^config\./, ''), v]));
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      saving = false;
    }
  }

  async function clearSecret(key: string) {
    if (!editing) return;
    try {
      const p = await api.patch(`/plugins/${editing.id}`, { config: { [key]: null } });
      replace(p);
      editing = p;
      toast.success(t('plugins.secret_cleared'));
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<svelte:head><title>{t('nav.plugins')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.plugins')} description={t('plugins.description')}>
  {#snippet actions()}{#if installAllowed}<PluginInstall />{/if}{/snippet}
</PageHeader>

{#if !plugins}
  <div class="grid gap-4 lg:grid-cols-2">{#each [1, 2] as i (i)}<Skeleton class="h-48 rounded-xl" />{/each}</div>
{:else if !plugins.length}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Media variant="icon"><PuzzleIcon /></Empty.Media>
      <Empty.Title>{t('plugins.empty_title')}</Empty.Title>
      <Empty.Description>{t('plugins.empty_description')}</Empty.Description>
    </Empty.Header>
  </Empty.Root>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    {#each plugins as p (p.id)}
      <Card.Root data-testid="plugin-card">
        <Card.Header>
          <Card.Title class="flex flex-wrap items-center gap-2">
            {p.name}
            <Badge variant="outline" class="font-mono">v{p.version}</Badge>
            <StatusBadge status={p.state === 'loaded' ? (p.enabled ? 'enabled' : 'disabled_by_user') : 'failed'} label={p.state === 'loaded' ? (p.enabled ? t('plugins.state.enabled') : t('plugins.state.off')) : t(`plugins.state.${p.state}`)} />
          </Card.Title>
          <Card.Description class="font-mono text-xs">{p.id}</Card.Description>
          <Card.Action>
            <Switch checked={p.enabled && p.state === 'loaded'} disabled={p.state !== 'loaded'} onCheckedChange={(v) => toggle(p, v)} aria-label={t('plugins.enable', { name: p.name })} />
          </Card.Action>
        </Card.Header>
        <Card.Content class="flex flex-col gap-3 text-sm">
          {#if p.error}
            <Alert.Root variant="destructive"><TriangleAlertIcon /><Alert.Title>{t(`plugins.state.${p.state}`)}</Alert.Title><Alert.Description>{p.error}</Alert.Description></Alert.Root>
          {/if}
          {#if p.warnings?.length}
            <Alert.Root data-testid="plugin-warnings"><TriangleAlertIcon /><Alert.Title>{t('plugins.manifest_warnings')}</Alert.Title><Alert.Description><ul class="list-disc pl-4">{#each p.warnings as w (w)}<li>{w}</li>{/each}</ul></Alert.Description></Alert.Root>
          {/if}
          {#if p.jobs?.length}
            <p class="text-muted-foreground text-xs">{t('plugins.jobs')}: {#each p.jobs as j, i (j.name)}{i ? ', ' : ''}<code class="font-mono">{j.name}</code> ({j.cron}){/each}</p>
          {/if}
          {#if p.provides.length}
            <div class="flex flex-wrap gap-1.5">{#each p.provides as cap (cap)}<Badge variant="secondary" class="font-mono text-xs">{cap}</Badge>{/each}</div>
          {/if}
          {#if p.permissions.length}
            <div class="text-muted-foreground flex flex-wrap items-center gap-1.5">
              <ShieldIcon class="size-3.5" /><span>{t('plugins.permissions')}:</span>
              {#each p.permissions as perm (perm)}<code class="bg-muted rounded px-1.5 py-0.5 text-xs">{perm}</code>{/each}
            </div>
          {/if}
        </Card.Content>
        {#if p.enabled && p.state === 'loaded' && p.provides.includes('notification:email')}
          <Card.Content class="min-w-0"><EmailDelivery compact /></Card.Content>
        {/if}
        {#if p.settings.length}
          <Card.Footer>
            <Button variant="outline" size="sm" onclick={() => configure(p)} disabled={p.state !== 'loaded'}><SettingsIcon />{t('plugins.configure')}</Button>
          </Card.Footer>
        {/if}
      </Card.Root>
    {/each}
  </div>
  <div class="mt-6 flex flex-col gap-4"><PluginSlot slot="settings.page" /></div>

  {#if hookErrors.length}
    <Card.Root class="mt-6">
      <Card.Header><Card.Title>{t('plugins.hook_errors')}</Card.Title><Card.Description>{t('plugins.hook_errors_hint')}</Card.Description></Card.Header>
      <Card.Content>
        <Table.Root>
          <Table.Header><Table.Row><Table.Head>{t('plugins.col.plugin')}</Table.Head><Table.Head>{t('plugins.col.hook')}</Table.Head><Table.Head>{t('plugins.col.error')}</Table.Head></Table.Row></Table.Header>
          <Table.Body>
            {#each hookErrors as h, i (i)}
              <Table.Row><Table.Cell class="font-mono text-xs">{h.pluginId}</Table.Cell><Table.Cell class="font-mono text-xs">{h.hook}</Table.Cell><Table.Cell class="whitespace-normal">{h.error}</Table.Cell></Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Content>
    </Card.Root>
  {/if}
{/if}

<Sheet.Root open={!!editing} onOpenChange={(o) => !o && (editing = null)}>
  <Sheet.Content class="data-[side=right]:w-full overflow-y-auto data-[side=right]:sm:max-w-lg">
    {#if editing}
      <form class="flex h-full flex-col" onsubmit={save}>
        <Sheet.Header>
          <Sheet.Title>{editing.name}</Sheet.Title>
          <Sheet.Description>{t('plugins.settings_hint')}</Sheet.Description>
        </Sheet.Header>
        <Field.Group class="px-4">
          {#each editing.settings as f (f.key)}
            <Field.Field data-invalid={!!errors[f.key] || undefined} orientation={f.type === 'boolean' ? 'horizontal' : 'vertical'}>
              {#if f.type === 'boolean'}
                <Switch id={`pf-${f.key}`} checked={!!form[f.key]} onCheckedChange={(v) => (form[f.key] = v)} />
                <Field.Label for={`pf-${f.key}`}>{f.label}</Field.Label>
              {:else}
                <Field.Label for={`pf-${f.key}`}>{f.label}{f.required ? ' *' : ''}</Field.Label>
                {#if f.type === 'select'}
                  <NativeSelect id={`pf-${f.key}`} class="w-full" bind:value={form[f.key] as string}>
                    <NativeSelectOption value="">{t('common.choose')}</NativeSelectOption>
                    {#each f.options ?? [] as o (o)}<NativeSelectOption value={o}>{o}</NativeSelectOption>{/each}
                  </NativeSelect>
                {:else if f.type === 'secret'}
                  <div class="flex gap-2">
                    <Input id={`pf-${f.key}`} type="password" autocomplete="off" bind:value={form[f.key] as string} placeholder={editing.secrets[f.key] ? t(`plugins.secret_${editing.secrets[f.key] as 'tenant' | 'installation'}`) : ''} aria-invalid={!!errors[f.key]} />
                    {#if editing.secrets[f.key] === 'tenant'}<Button type="button" variant="ghost" onclick={() => clearSecret(f.key)}>{t('plugins.clear')}</Button>{/if}
                  </div>
                {:else}
                  <Input id={`pf-${f.key}`} type={f.type === 'number' ? 'number' : 'text'} bind:value={form[f.key] as string} aria-invalid={!!errors[f.key]} />
                {/if}
              {/if}
              {#if errors[f.key]}<Field.Error>{errors[f.key]}</Field.Error>{:else if f.help}<Field.Description>{f.help}</Field.Description>{/if}
            </Field.Field>
          {/each}
        </Field.Group>
        <Sheet.Footer class="mt-auto">
          <Button type="submit" disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button>
          <Sheet.Close>{#snippet child({ props })}<Button variant="outline" {...props}>{t('common.cancel')}</Button>{/snippet}</Sheet.Close>
        </Sheet.Footer>
      </form>
    {/if}
  </Sheet.Content>
</Sheet.Root>
