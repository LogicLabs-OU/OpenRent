<script lang="ts">
  import { untrack } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Textarea } from '@openrent/ui/textarea';
  import { Button } from '@openrent/ui/button';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { api, session, t, toast, notifyError, fieldErrors } from '#lib';

  /**
   * The sites that embed the booking widget (FR-SF-2). The widget checkout only sends customers back
   * to these after paying, so it cannot be used to redirect anywhere else.
   */
  let { origins = [] }: { origins?: string[] } = $props();
  // The form starts from the saved list and is edited locally until saved.
  let text = $state(untrack(() => origins.join('\n')));
  let error = $state('');
  let saving = $state(false);

  // The API serves the admin, so the admin's origin is where the widget script and API live.
  const apiUrl = location.origin;
  const embed = $derived(
    `<script src="${apiUrl}/widget/openrent-widget.js" data-openrent-api="${apiUrl}"><\/script>\n<openrent-category category="" shop="${session.me?.tenant?.slug ?? ''}"></openrent-category>`,
  );

  async function save() {
    saving = true;
    error = '';
    try {
      const list = text.split(/\s+/).map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
      const r = await api.patch('/tenant/settings', { widget_origins: list });
      text = r.widget_origins.join('\n');
      toast.success(t('common.saved'));
    } catch (err) {
      const e = fieldErrors(err);
      error = Object.entries(e).find(([k]) => k.startsWith('widget_origins'))?.[1] ?? '';
      if (!error) notifyError(err);
    } finally {
      saving = false;
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(embed).catch(() => undefined);
    toast.success(t('calendar.copied'));
  }
</script>

<Card.Root data-testid="widget-sites">
  <Card.Header>
    <Card.Title>{t('widget.sites_title')}</Card.Title>
    <Card.Description>{t('widget.sites_hint')}</Card.Description>
  </Card.Header>
  <Card.Content>
    <Field.Group>
      <Field.Field data-invalid={!!error || undefined}>
        <Field.Label for="widget-origins">{t('widget.sites')}</Field.Label>
        <Textarea id="widget-origins" class="font-mono text-xs" rows={3} placeholder="https://www.example.com" bind:value={text} aria-invalid={!!error} />
        {#if error}<Field.Error>{error}</Field.Error>{:else}<Field.Description>{t('widget.sites_one_per_line')}</Field.Description>{/if}
      </Field.Field>
      <Field.Field>
        <Field.Label for="widget-embed">{t('widget.embed_code')}</Field.Label>
        <Textarea id="widget-embed" class="font-mono text-xs" rows={3} readonly value={embed} />
        <div><Button type="button" size="sm" variant="ghost" onclick={copy}><CopyIcon />{t('calendar.copy')}</Button></div>
      </Field.Field>
    </Field.Group>
  </Card.Content>
  <Card.Footer><Button onclick={save} disabled={saving}>{t('common.save')}</Button></Card.Footer>
</Card.Root>
