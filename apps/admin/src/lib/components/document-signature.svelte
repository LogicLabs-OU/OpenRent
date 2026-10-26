<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import PenLineIcon from '@lucide/svelte/icons/pen-line';
  import FileCheckIcon from '@lucide/svelte/icons/file-check';
  import XIcon from '@lucide/svelte/icons/x';
  import { api, t, toast, notifyError, download, session, confirmAction } from '#lib';

  /** A document's e-signature (FR-DOC-5): ask the customer to sign, see it waiting or signed, get the signed PDF. */
  let { doc }: { doc: { id: string; type: string; status: string } } = $props();
  let state = $state<{ requests: any[]; signatures: any[] } | null>(null);
  const SIGNABLE = ['contract', 'quote', 'confirmation'];
  const canEdit = $derived(session.can('documents:write'));
  const pending = $derived(state?.requests.find((r) => r.status === 'pending'));
  const signed = $derived(state?.signatures[0]);

  async function load() {
    state = await api.get(`/documents/${doc.id}/signatures`);
  }
  onMount(() => {
    if (SIGNABLE.includes(doc.type)) load().catch(notifyError);
  });

  async function request() {
    try {
      const r = await api.post(`/documents/${doc.id}/actions/request_signature`, {});
      toast.success(t('signature.requested', { email: r.signer_email }));
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
  async function cancel() {
    if (!(await confirmAction({ title: t('signature.cancel_title'), description: t('signature.cancel_description'), confirmLabel: t('signature.cancel') }))) return;
    try {
      await api.post(`/signature_requests/${pending.id}/actions/cancel`, {});
      await load();
    } catch (e) {
      notifyError(e);
    }
  }
</script>

{#if state}
  {#if signed}
    <Badge variant="secondary" title={t('signature.signed_by', { name: signed.signer_name })}>{t('signature.signed')}</Badge>
    {#if signed.has_pdf}<Button variant="ghost" size="icon-sm" aria-label={t('signature.signed_pdf')} title={t('signature.signed_pdf')} onclick={() => download(`/signatures/${signed.id}/pdf`).catch(notifyError)}><FileCheckIcon /></Button>{/if}
  {:else if pending}
    <Badge variant="outline" title={pending.signer_email}>{t('signature.waiting')}</Badge>
    {#if canEdit}<Button variant="ghost" size="icon-sm" aria-label={t('signature.cancel')} title={t('signature.cancel')} onclick={cancel}><XIcon /></Button>{/if}
  {:else if canEdit && ['issued', 'sent'].includes(doc.status)}
    <Button variant="ghost" size="icon-sm" aria-label={t('signature.request')} title={t('signature.request')} onclick={request}><PenLineIcon /></Button>
  {/if}
{/if}
