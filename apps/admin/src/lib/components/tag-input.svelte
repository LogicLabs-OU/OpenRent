<script lang="ts">
  import { Badge } from '@openrent/ui/badge';
  import { Input } from '@openrent/ui/input';
  import XIcon from '@lucide/svelte/icons/x';
  import { api, t } from '#lib';

  /** Tags on a product, order or customer, with suggestions from tags already in use. Enter or comma adds one. */
  let { value = $bindable([]), entity, id, onchange }: { value?: string[]; entity: 'product' | 'order' | 'customer'; id?: string; onchange?: (tags: string[]) => void } = $props();
  let draft = $state('');
  let known = $state<{ tag: string; count: number }[]>([]);
  let focused = $state(false);

  async function suggest() {
    known = (await api.get(`/tags?entity=${entity}&q=${encodeURIComponent(draft.trim())}`)).data;
  }
  const options = $derived(known.filter((k) => !value.includes(k.tag)).slice(0, 8));

  function add(tag: string) {
    const v = tag.trim().replace(/,$/, '').slice(0, 40);
    if (!v || value.includes(v)) return;
    value = [...value, v];
    draft = '';
    onchange?.(value);
  }
  function remove(tag: string) {
    value = value.filter((x) => x !== tag);
    onchange?.(value);
  }
  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) remove(value[value.length - 1]!);
  }
</script>

<div class="flex flex-col gap-2" data-testid="tag-input">
  {#if value.length}
    <ul class="flex flex-wrap gap-1.5" aria-label={t('tags.current')}>
      {#each value as tag (tag)}
        <li>
          <Badge variant="secondary" class="gap-1 pr-1">
            {tag}
            <button type="button" class="rounded-sm opacity-60 hover:opacity-100" aria-label={t('tags.remove', { tag })} onclick={() => remove(tag)}><XIcon class="size-3" /></button>
          </Badge>
        </li>
      {/each}
    </ul>
  {/if}
  <Input
    {id}
    bind:value={draft}
    placeholder={t('tags.placeholder')}
    autocomplete="off"
    onkeydown={keydown}
    oninput={() => suggest().catch(() => undefined)}
    onfocus={() => {
      focused = true;
      suggest().catch(() => undefined);
    }}
    onblur={() => setTimeout(() => (focused = false), 150)}
  />
  {#if focused && options.length}
    <div class="flex flex-wrap gap-1.5" role="listbox" aria-label={t('tags.suggestions')}>
      {#each options as o (o.tag)}
        <button type="button" role="option" aria-selected="false" class="hover:bg-accent rounded-md border px-2 py-0.5 text-xs" onmousedown={(e) => e.preventDefault()} onclick={() => add(o.tag)}>{o.tag}</button>
      {/each}
    </div>
  {/if}
</div>
