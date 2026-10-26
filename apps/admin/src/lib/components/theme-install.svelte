<script lang="ts">
  import * as Dialog from '@openrent/ui/dialog';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { api, upload, t, toast, notifyError, fieldErrors } from '#lib';

  /**
   * Install or update a child theme (FR-THM-8): upload its ZIP, see which files change and which saved
   * settings would be dropped, then confirm.
   */
  let { oninstalled }: { oninstalled?: () => void } = $props();
  let open = $state(false);
  let file = $state<File | null>(null);
  let staged = $state<any>(null);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  async function check(e: SubmitEvent) {
    e.preventDefault();
    if (!file) return;
    busy = true;
    errors = {};
    try {
      staged = await upload('/themes/install', file);
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
      const r = await api.post(`/themes/install/${staged.id}/actions/confirm`, {});
      toast.success(t('themes.install.done', { name: r.theme.name, version: r.theme.version }));
      open = false;
      oninstalled?.();
    } catch (err) {
      notifyError(err);
    } finally {
      busy = false;
    }
  }

  const groups = $derived(staged ? (['added', 'changed', 'removed'] as const).filter((k) => staged.diff[k].length) : []);
</script>

<Button variant="outline" onclick={() => { file = null; staged = null; errors = {}; open = true; }} data-testid="theme-install"><UploadIcon />{t('themes.install.button')}</Button>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{staged ? (staged.update ? t('themes.install.update_title', { name: staged.theme.name }) : t('themes.install.new_title', { name: staged.theme.name })) : t('themes.install.button')}</Dialog.Title>
      <Dialog.Description>{t('themes.install.hint')}</Dialog.Description>
    </Dialog.Header>
    {#if !staged}
      <form id="theme-install-form" onsubmit={check}>
        <Field.Field data-invalid={!!errors.file || undefined}>
          <Field.Label for="theme-zip">{t('themes.install.file')}</Field.Label>
          <Input id="theme-zip" type="file" accept=".zip,application/zip" onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} aria-invalid={!!errors.file} />
          {#if errors.file}<Field.Error>{errors.file}</Field.Error>{/if}
        </Field.Field>
      </form>
    {:else}
      <div class="flex flex-col gap-3 text-sm" data-testid="theme-install-review">
        <p>{t('themes.install.summary', { version: staged.theme.version, parent: staged.theme.extends })}{#if staged.update}{' '}{t('themes.install.from', { version: staged.update.from_version })}{/if}</p>
        {#each groups as g (g)}
          <div>
            <p class="font-medium">{t(`themes.install.${g}` as any)}</p>
            <ul class="text-muted-foreground mt-1 font-mono text-xs">{#each staged.diff[g] as f (f)}<li>{f}</li>{/each}</ul>
          </div>
        {/each}
        {#if staged.update && !groups.length}<p class="text-muted-foreground">{t('themes.install.no_changes')}</p>{/if}
        {#if staged.diff.removed_settings.length}
          <Alert.Root variant="destructive"><TriangleAlertIcon /><Alert.Title>{t('themes.install.removed_settings')}</Alert.Title><Alert.Description>{staged.diff.removed_settings.join(', ')}</Alert.Description></Alert.Root>
        {/if}
      </div>
    {/if}
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>{t('common.cancel')}</Button>
      {#if staged}
        <Button onclick={confirm} disabled={busy}>{#if busy}<Spinner />{/if}{staged.update ? t('themes.install.update') : t('themes.install.install')}</Button>
      {:else}
        <Button type="submit" form="theme-install-form" disabled={busy || !file}>{#if busy}<Spinner />{/if}{t('plugins.install.check')}</Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
