<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { Toggle } from '@openrent/ui/toggle';
  import { Button } from '@openrent/ui/button';
  import { Input } from '@openrent/ui/input';
  import * as Popover from '@openrent/ui/popover';
  import BoldIcon from '@lucide/svelte/icons/bold';
  import ItalicIcon from '@lucide/svelte/icons/italic';
  import Heading2Icon from '@lucide/svelte/icons/heading-2';
  import ListIcon from '@lucide/svelte/icons/list';
  import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
  import QuoteIcon from '@lucide/svelte/icons/quote';
  import LinkIcon from '@lucide/svelte/icons/link';
  import { t } from '#lib';

  /**
   * Product descriptions (FR-CAT-1): paragraphs, headings, lists, quotes and links. The API cleans the
   * HTML on save; plain text from older products opens as paragraphs.
   */
  let { value = $bindable(''), id, label, lang }: { value?: string; id?: string; label: string; lang?: string } = $props();

  let host: HTMLDivElement | undefined = $state();
  let editor = $state.raw<Editor | null>(null);
  // Bumped on every transaction so the toolbar shows the current marks.
  let tick = $state(0);
  let linkOpen = $state(false);
  let href = $state('');

  const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const asHtml = (v: string) => (/<\/?[a-z][\s\S]*>/i.test(v) ? v : v.split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join(''));

  onMount(() => {
    editor = new Editor({
      element: host!,
      extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, horizontalRule: false, link: { openOnClick: false, autolink: true, protocols: ['mailto', 'tel'] } })],
      content: asHtml(value ?? ''),
      editorProps: {
        attributes: {
          ...(id ? { id } : {}),
          ...(lang ? { lang } : {}),
          'aria-label': label,
          'aria-multiline': 'true',
          role: 'textbox',
          class: 'rich-text min-h-32 rounded-b-md border border-t-0 px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        },
      },
      onUpdate: ({ editor: e }) => (value = e.isEmpty ? '' : e.getHTML()),
      onTransaction: () => tick++,
    });
  });
  onDestroy(() => editor?.destroy());

  const active = (name: string, attrs?: Record<string, unknown>) => (void tick, !!editor?.isActive(name, attrs));
  const run = (fn: (c: any) => any) => fn(editor!.chain().focus()).run();
  // Toolbar buttons must not take focus (and the selection) away from the text.
  const keep = (e: MouseEvent) => e.preventDefault();

  $effect(() => {
    if (linkOpen) href = editor?.getAttributes('link').href ?? '';
  });
  function applyLink(e: SubmitEvent) {
    e.preventDefault();
    const url = href.trim();
    if (!url) run((c) => c.extendMarkRange('link').unsetLink());
    else run((c) => c.extendMarkRange('link').setLink({ href: /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}` }));
    linkOpen = false;
  }
</script>

<div class="flex flex-col" data-testid="rich-text-editor">
  <div class="bg-muted/40 flex flex-wrap gap-1 rounded-t-md border p-1" role="toolbar" aria-label={t('editor.toolbar')}>
    <Toggle size="sm" pressed={active('bold')} onmousedown={keep} onclick={() => run((c) => c.toggleBold())} aria-label={t('editor.bold')}><BoldIcon /></Toggle>
    <Toggle size="sm" pressed={active('italic')} onmousedown={keep} onclick={() => run((c) => c.toggleItalic())} aria-label={t('editor.italic')}><ItalicIcon /></Toggle>
    <Toggle size="sm" pressed={active('heading', { level: 2 })} onmousedown={keep} onclick={() => run((c) => c.toggleHeading({ level: 2 }))} aria-label={t('editor.heading')}><Heading2Icon /></Toggle>
    <Toggle size="sm" pressed={active('bulletList')} onmousedown={keep} onclick={() => run((c) => c.toggleBulletList())} aria-label={t('editor.bullet_list')}><ListIcon /></Toggle>
    <Toggle size="sm" pressed={active('orderedList')} onmousedown={keep} onclick={() => run((c) => c.toggleOrderedList())} aria-label={t('editor.numbered_list')}><ListOrderedIcon /></Toggle>
    <Toggle size="sm" pressed={active('blockquote')} onmousedown={keep} onclick={() => run((c) => c.toggleBlockquote())} aria-label={t('editor.quote')}><QuoteIcon /></Toggle>
    <Popover.Root bind:open={linkOpen}>
      <Popover.Trigger>
        {#snippet child({ props })}<Toggle size="sm" {...props} pressed={active('link')} onmousedown={keep} aria-label={t('editor.link')}><LinkIcon /></Toggle>{/snippet}
      </Popover.Trigger>
      <Popover.Content class="w-80">
        <form class="flex gap-2" onsubmit={applyLink}>
          <Input type="text" inputmode="url" placeholder="https://" bind:value={href} aria-label={t('editor.link_address')} />
          <Button type="submit" size="sm">{t('common.save')}</Button>
        </form>
      </Popover.Content>
    </Popover.Root>
  </div>
  <div bind:this={host}></div>
</div>
