<script lang="ts">
  import { getRuntime, type SearchData } from '@openrent/theme-sdk';
  import * as InputGroup from '@openrent/ui/input-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Switch } from '@openrent/ui/switch';
  import { Label } from '@openrent/ui/label';
  import { Button } from '@openrent/ui/button';
  import SearchIcon from '@lucide/svelte/icons/search';
  import PageHeader from '../snippets/PageHeader.svelte';
  import Callout from '../snippets/Callout.svelte';
  import Database from '../snippets/Database.svelte';
  import { col, label } from '../lib/concept.ts';

  /** Plain GET form: works before the page is interactive and keeps the URL shareable. */
  let { data }: { data: SearchData } = $props();
  const rt = getRuntime();
  const datesSet = $derived(!!rt.shop.dates.from && !!rt.shop.dates.to);
  let form: HTMLFormElement | undefined = $state();
  const submit = () => form?.requestSubmit();
</script>

<PageHeader
  title={data.query ? rt.t('search.results_for', { query: data.query }) : rt.t('search.title')}
  icon="🔍"
/>
<div class={[col, 'flex flex-col gap-5']}>
  <form
    bind:this={form}
    method="GET"
    action={rt.url.search?.() ?? '/search'}
    class="flex flex-col gap-3"
    role="search"
  >
    <InputGroup.Root class="h-10 bg-(--concept-wash)">
      <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
      <InputGroup.Input
        name="q"
        type="search"
        value={data.query}
        placeholder={rt.t('search.placeholder')}
        aria-label={rt.t('search.label')}
      />
      <InputGroup.Addon align="inline-end"
        ><InputGroup.Button type="submit" variant="default">{rt.t('search.submit')}</InputGroup.Button
        ></InputGroup.Addon
      >
    </InputGroup.Root>
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label class={label} for="or-s-cat">{rt.t('search.category')}</Label>
        <NativeSelect id="or-s-cat" size="sm" name="category" value={data.category ?? ''} onchange={submit}>
          <NativeSelectOption value="">{rt.t('nav.all')}</NativeSelectOption>
          {#each rt.shop.categories as c (c.id)}<NativeSelectOption value={c.slug}
              >{c.name}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </div>
      <div class="flex flex-col gap-1">
        <Label class={label} for="or-s-sort">{rt.t('search.sort')}</Label>
        <NativeSelect id="or-s-sort" size="sm" name="sort" value={data.sort} onchange={submit}>
          {#each ['relevance', 'name', 'newest'] as s (s)}<NativeSelectOption value={s}
              >{rt.t(`search.sort.${s}`)}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </div>
      {#if datesSet}
        <div class="flex h-8 items-center gap-2">
          <Switch
            id="or-s-free"
            name="available"
            value="1"
            checked={data.available}
            onCheckedChange={() => queueMicrotask(submit)}
          />
          <Label for="or-s-free" class="font-normal">{rt.t('search.available')}</Label>
        </div>
      {/if}
    </div>
  </form>
  <p class="text-muted-foreground text-sm" role="status" data-testid="search-count">
    {rt.t('search.count', { count: data.products.length })}
  </p>
  {#if data.products.length}
    <Database products={data.products} />
  {:else}
    <Callout icon="🫥">
      <p class="font-medium">{rt.t('search.empty')}</p>
      <p class="text-muted-foreground">{rt.t('search.empty_hint')}</p>
      <Button class="mt-3" size="sm" variant="outline" href={rt.url.search?.() ?? '/search'}
        >{rt.t('search.clear')}</Button
      >
    </Callout>
  {/if}
</div>
