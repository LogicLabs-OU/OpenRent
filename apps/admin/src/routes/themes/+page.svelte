<script lang="ts">
  import * as Card from '@openrent/ui/card';
  import * as Alert from '@openrent/ui/alert';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { PageHeader } from '@openrent/ui/openrent';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import PaintbrushIcon from '@lucide/svelte/icons/paintbrush';
  import RocketIcon from '@lucide/svelte/icons/rocket';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import { api, t, toast, notifyError, confirmAction } from '#lib';
  import { to } from '#lib/nav.ts';
  import CustomCode from '#lib/components/custom-code.svelte';
  import SeoSettings from '#lib/components/seo-settings.svelte';
  import ThemeInstall from '#lib/components/theme-install.svelte';

  let themes = $state<any[] | null>(null);

  async function load() {
    try {
      themes = (await api.get('/themes')).data;
    } catch (e) {
      notifyError(e);
    }
  }
  load();

  /** Opens a signed preview link: the storefront shows this theme to this browser only. */
  async function preview(id: string) {
    const tab = window.open('about:blank', '_blank');
    try {
      const r = await api.post(`/themes/${id}/actions/preview`);
      if (tab) tab.location.href = r.url;
      else window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      tab?.close();
      notifyError(e);
    }
  }

  async function remove(th: any) {
    if (!(await confirmAction({ title: t('themes.remove_title', { name: th.name }), description: t('themes.remove_description'), confirmLabel: t('common.remove'), destructive: true }))) return;
    try {
      await api.del(`/themes/${th.id}`);
      await load();
    } catch (e) {
      notifyError(e);
    }
  }

  async function publish(th: any) {
    if (!(await confirmAction({ title: t('themes.publish_title', { name: th.name }), description: t('themes.publish_description'), confirmLabel: t('themes.publish') }))) return;
    try {
      await api.post(`/themes/${th.id}/actions/publish`);
      toast.success(t('themes.published', { name: th.name }));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

<svelte:head><title>{t('nav.themes')} · OpenRent</title></svelte:head>

<PageHeader title={t('nav.themes')} description={t('themes.description')}>
  {#snippet actions()}<ThemeInstall oninstalled={load} />{/snippet}
</PageHeader>

{#if !themes}
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{#each [1, 2, 3] as i (i)}<Skeleton class="h-72 rounded-xl" />{/each}</div>
{:else}
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    {#each themes as th (th.id)}
      <Card.Root class="pt-0" data-testid="theme-card">
        {#if th.preview_images?.[0]}
          <img class="aspect-video w-full object-cover" src={th.preview_images[0]} alt="" />
        {:else}
          <div class="from-primary/70 to-primary/20 text-primary-foreground flex aspect-video items-center justify-center bg-gradient-to-br text-4xl font-semibold" aria-hidden="true">{th.name[0]}</div>
        {/if}
        <Card.Header>
          <Card.Title class="flex flex-wrap items-center gap-2">
            {th.name}
            {#if th.live}<Badge class="gap-1"><CircleCheckIcon class="size-3" />{t('themes.live')}</Badge>{/if}
            {#if th.extends}<Badge variant="secondary">{t('themes.extends', { parent: th.extends })}</Badge>{/if}
          </Card.Title>
          <Card.Description>{t('themes.byline', { version: th.version, author: th.author })}</Card.Description>
        </Card.Header>
        {#if th.problems.length}
          <Card.Content>
            <Alert.Root variant="destructive">
              <TriangleAlertIcon />
              <Alert.Title>{t('themes.incompatible')}</Alert.Title>
              <Alert.Description><ul class="list-disc pl-4">{#each th.problems as p (p)}<li>{p}</li>{/each}</ul></Alert.Description>
            </Alert.Root>
          </Card.Content>
        {/if}
        <Card.Footer class="mt-auto flex-wrap gap-2">
          <Button size="sm" href={to(`/themes/${th.id}`)}><PaintbrushIcon />{t('themes.customize')}</Button>
          <Button size="sm" variant="outline" onclick={() => preview(th.id)}><EyeIcon />{t('themes.preview')}</Button>
          {#if !th.live}<Button size="sm" variant="outline" disabled={th.status !== 'ok'} onclick={() => publish(th)}><RocketIcon />{t('themes.publish')}</Button>{/if}
          {#if th.extends && !th.live}<Button size="sm" variant="ghost" onclick={() => remove(th)}>{t('common.remove')}</Button>{/if}
        </Card.Footer>
      </Card.Root>
    {/each}
  </div>
  <SeoSettings />
  <CustomCode />
  <p class="text-muted-foreground mt-6 text-sm">{t('themes.install_hint_child')}</p>
{/if}
