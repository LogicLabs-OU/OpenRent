<script lang="ts">
  import { getRuntime, type OrderAttachment, type OrderDocument } from '@openrent/theme-sdk';
  import { Button } from '@openrent/ui/button';
  import FileDownIcon from '@lucide/svelte/icons/file-down';
  import PaperclipIcon from '@lucide/svelte/icons/paperclip';

  /** Download links for a booking's documents (when the shop renders PDFs) and the files the shop shared. */
  let {
    documents,
    attachments = [],
    orderToken,
  }: {
    documents: OrderDocument[] | undefined;
    attachments?: OrderAttachment[];
    orderToken?: string;
  } = $props();
  const rt = getRuntime();
  const label = (d: OrderDocument) => {
    const name = rt.t(`document.${d.type}`);
    return `${name === `document.${d.type}` ? d.type : name}${d.number ? ` ${d.number}` : ''}`;
  };
</script>

{#if (documents?.length && rt.shop.features?.document_pdfs && rt.url.document) || (attachments.length && rt.url.attachment)}
  <ul class="flex flex-wrap gap-2" aria-label={rt.t('document.list')}>
    {#each rt.shop.features?.document_pdfs && rt.url.document ? (documents ?? []) : [] as d (d.id)}
      <li>
        <Button variant="outline" size="sm" href={rt.url.document!(d.id, orderToken)} data-sveltekit-reload
          ><FileDownIcon />{label(d)}</Button
        >
      </li>
    {/each}
    {#if rt.url.attachment}
      {#each attachments as a (a.id)}
        <li>
          <Button variant="outline" size="sm" href={rt.url.attachment(a.id, orderToken)} data-sveltekit-reload
            ><PaperclipIcon />{a.label}</Button
          >
        </li>
      {/each}
    {/if}
  </ul>
{/if}
