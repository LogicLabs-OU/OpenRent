<script lang="ts">
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import CameraIcon from '@lucide/svelte/icons/camera';
  import { api, upload, t, notifyError } from '#lib';

  /** Thumbnails of staff photos (damage, maintenance) with an upload button; the camera opens on phones. */
  let { photos = [], attachPath, onadded }: { photos?: { file_id: string; url: string; url_sm: string }[]; attachPath: string; onadded?: () => void } = $props();
  let input: HTMLInputElement | undefined = $state();
  let busy = $state(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    busy = true;
    try {
      for (const file of Array.from(files)) {
        const f = await upload('/files?purpose=photo', file);
        await api.post(attachPath, { file_id: f.id });
      }
      onadded?.();
    } catch (e) {
      notifyError(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex flex-wrap items-center gap-2">
  {#each photos as p (p.file_id)}
    <a href={p.url} target="_blank" rel="noopener" class="block size-14 overflow-hidden rounded-md border"><img src={p.url_sm} alt="" class="size-full object-cover" loading="lazy" /></a>
  {/each}
  <Button type="button" variant="outline" size="sm" class="h-14" disabled={busy} onclick={() => input?.click()} aria-label={t('photos.add')}>
    {#if busy}<Spinner />{:else}<CameraIcon />{/if}<span class="hidden sm:inline">{t('photos.add')}</span>
  </Button>
  <input bind:this={input} type="file" accept="image/*" capture="environment" multiple class="hidden" onchange={(e) => { add((e.currentTarget as HTMLInputElement).files); (e.currentTarget as HTMLInputElement).value = ''; }} />
</div>
