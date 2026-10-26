<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Empty from '@openrent/ui/empty';
  import { Button } from '@openrent/ui/button';
  import { Input } from '@openrent/ui/input';
  import { Spinner } from '@openrent/ui/spinner';
  import ImagePlusIcon from '@lucide/svelte/icons/image-plus';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { api, upload, session, t, toast, notifyError, confirmAction } from '#lib';

  /** Product photo gallery: upload (drop or pick), alt text, order and removal (FR-CAT-1). */
  let { productId, images = $bindable([]) }: { productId: string; images: any[] } = $props();
  let busy = $state(0);
  let dragging = $state(false);
  let input: HTMLInputElement | undefined = $state();
  const locale = $derived(session.me?.tenant?.locale ?? 'en');

  async function add(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      busy++;
      try {
        const f = await upload('/files?purpose=image', file);
        images = [...images, await api.post(`/products/${productId}/images`, { file_id: f.id, alt: {} })];
      } catch (e) {
        notifyError(e);
      } finally {
        busy--;
      }
    }
  }

  async function move(i: number, by: number) {
    const next = [...images];
    const [img] = next.splice(i, 1);
    next.splice(i + by, 0, img);
    try {
      images = (await api.put(`/products/${productId}/images/order`, { ids: next.map((x) => x.id) })).data;
    } catch (e) {
      notifyError(e);
    }
  }

  async function saveAlt(img: any, value: string) {
    try {
      const updated = await api.patch(`/products/${productId}/images/${img.id}`, { alt: { ...img.alt, [locale]: value } });
      images = images.map((x) => (x.id === img.id ? updated : x));
    } catch (e) {
      notifyError(e);
    }
  }

  async function remove(img: any) {
    if (!(await confirmAction({ title: t('images.remove_title'), description: t('images.remove_description'), confirmLabel: t('common.remove'), destructive: true }))) return;
    try {
      await api.del(`/products/${productId}/images/${img.id}`);
      images = images.filter((x) => x.id !== img.id);
      toast.success(t('common.removed'));
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<Card.Root data-testid="image-gallery">
  <Card.Header>
    <Card.Title>{t('images.title')}</Card.Title>
    <Card.Description>{t('images.hint')}</Card.Description>
    <Card.Action>
      <Button size="sm" variant="outline" disabled={busy > 0} onclick={() => input?.click()}>{#if busy}<Spinner />{:else}<ImagePlusIcon />{/if}{t('images.add')}</Button>
    </Card.Action>
  </Card.Header>
  <Card.Content>
    <input bind:this={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple class="hidden" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files; if (f) add(f); (e.currentTarget as HTMLInputElement).value = ''; }} data-testid="image-input" />
    <div
      role="group"
      aria-label={t('images.drop')}
      class={['rounded-lg transition-colors', dragging && 'bg-primary/5 ring-primary ring-2 ring-dashed']}
      ondragover={(e) => { e.preventDefault(); dragging = true; }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => { e.preventDefault(); dragging = false; if (e.dataTransfer?.files.length) add(e.dataTransfer.files); }}
    >
      {#if images.length}
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {#each images as img, i (img.id)}
            <li class="bg-card flex flex-col gap-2 rounded-lg border p-2">
              <div class="bg-muted relative aspect-[4/3] overflow-hidden rounded-md">
                <img src={img.url_sm} alt={img.alt?.[locale] ?? ''} class="size-full object-cover" loading="lazy" />
                {#if i === 0}<span class="bg-background/90 absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-xs font-medium">{t('images.cover')}</span>{/if}
              </div>
              <Input class="h-8 text-xs" placeholder={t('images.alt')} aria-label={t('images.alt')} value={img.alt?.[locale] ?? ''} onchange={(e) => saveAlt(img, (e.currentTarget as HTMLInputElement).value)} />
              <div class="flex items-center justify-between">
                <div class="flex gap-1">
                  <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={t('images.move_left')} onclick={() => move(i, -1)}><ArrowLeftIcon /></Button>
                  <Button variant="ghost" size="icon-sm" disabled={i === images.length - 1} aria-label={t('images.move_right')} onclick={() => move(i, 1)}><ArrowRightIcon /></Button>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onclick={() => remove(img)}><Trash2Icon /></Button>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <Empty.Root class="border border-dashed">
          <Empty.Header>
            <Empty.Media variant="icon"><ImagePlusIcon /></Empty.Media>
            <Empty.Title>{t('images.empty')}</Empty.Title>
            <Empty.Description>{t('images.drop')}</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
