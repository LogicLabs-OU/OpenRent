<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import PackagePlusIcon from '@lucide/svelte/icons/package-plus';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { api, upload, t, toast, notifyError, fieldErrors } from '#lib';

  /**
   * Install a plugin package (FR-PLG-2): upload a ZIP or give its URL, read what it asks for, then
   * confirm. The plugin loads after OpenRent restarts; plugins run as trusted code.
   */
  let open = $state(false);
  let url = $state('');
  let file = $state<File | null>(null);
  let staged = $state<any>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  function reset() {
    url = '';
    file = null;
    staged = null;
    errors = {};
  }

  async function check(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      staged = file ? await upload('/plugins/install', file) : await api.post('/plugins/install', { url });
    } catch (err) {
      errors = fieldErrors(err);
      if (!Object.keys(errors).length) notifyError(err);
    } finally {
      busy = false;
    }
  }

  async function confirm() {
    busy = true;
    try {
      const r = await api.post(`/plugins/install/${staged.id}/actions/confirm`, {});
      toast.success(t('plugins.install.done', { name: r.plugin.name }));
      open = false;
      reset();
    } catch (err) {
      notifyError(err);
    } finally {
      busy = false;
    }
  }
</script>

<Button variant="outline" onclick={() => { reset(); open = true; }} data-testid="plugin-install"><PackagePlusIcon />{t('plugins.install.button')}</Button>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{staged ? t('plugins.install.review', { name: staged.plugin.name }) : t('plugins.install.button')}</Dialog.Title>
      <Dialog.Description>{t('plugins.install.hint')}</Dialog.Description>
    </Dialog.Header>
    {#if !staged}
      <form id="plugin-install-form" class="flex flex-col gap-4" onsubmit={check}>
        <Field.Field data-invalid={!!errors.file || undefined}>
          <Field.Label for="plugin-zip">{t('plugins.install.file')}</Field.Label>
          <Input id="plugin-zip" type="file" accept=".zip,application/zip" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} aria-invalid={!!errors.file} />
          {#if errors.file}<Field.Error>{errors.file}</Field.Error>{/if}
        </Field.Field>
        <Field.Field data-invalid={!!errors.url || undefined}>
          <Field.Label for="plugin-url">{t('plugins.install.url')}</Field.Label>
          <Input id="plugin-url" type="url" placeholder="https://" bind:value={url} disabled={!!file} aria-invalid={!!errors.url} />
          {#if errors.url}<Field.Error>{errors.url}</Field.Error>{/if}
        </Field.Field>
      </form>
    {:else}
      <div class="flex flex-col gap-3 text-sm" data-testid="plugin-install-review">
        <p><span class="font-medium">{staged.plugin.name}</span> {staged.plugin.version}{#if staged.plugin.author} · {staged.plugin.author}{/if}</p>
        {#if staged.replaces}<p class="text-muted-foreground">{t('plugins.install.replaces', { version: staged.replaces.version })}</p>{/if}
        <div>
          <p class="font-medium">{t('plugins.install.asks_for')}</p>
          {#if staged.plugin.permissions.length}
            <ul class="mt-1 flex flex-wrap gap-1.5">{#each staged.plugin.permissions as perm (perm)}<li><code class="bg-muted rounded px-1.5 py-0.5 text-xs">{perm}</code></li>{/each}</ul>
          {:else}<p class="text-muted-foreground">{t('plugins.install.no_permissions')}</p>{/if}
        </div>
        {#if staged.warnings.length}
          <Alert.Root><TriangleAlertIcon /><Alert.Title>{t('plugins.manifest_warnings')}</Alert.Title><Alert.Description><ul class="list-disc pl-4">{#each staged.warnings as w (w)}<li>{w}</li>{/each}</ul></Alert.Description></Alert.Root>
        {/if}
        <Alert.Root variant="destructive"><ShieldAlertIcon /><Alert.Title>{t('plugins.install.trust')}</Alert.Title></Alert.Root>
      </div>
    {/if}
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>{t('common.cancel')}</Button>
      {#if staged}
        <Button onclick={confirm} disabled={busy}>{#if busy}<Spinner />{/if}{t('plugins.install.confirm')}</Button>
      {:else}
        <Button type="submit" form="plugin-install-form" disabled={busy || (!file && !url)}>{#if busy}<Spinner />{/if}{t('plugins.install.check')}</Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
