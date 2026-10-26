<script lang="ts">
  import { getRuntime, type SearchData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import * as Field from '@openrent/ui/field';
  import * as InputGroup from '@openrent/ui/input-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Switch } from '@openrent/ui/switch';
  import { Button } from '@openrent/ui/button';
  import SearchIcon from '@lucide/svelte/icons/search';
  import SearchXIcon from '@lucide/svelte/icons/search-x';
  import ProductCard from '../snippets/ProductCard.svelte';
  import PageHead from '../snippets/PageHead.svelte';
  import { glass } from '../lib/nightfall.ts';
  import { reveal } from '../lib/motion.ts';

  /** Plain GET form: works before the page is interactive and keeps the URL shareable. */
  let { data }: { data: SearchData } = $props();
  const rt = getRuntime();
  const datesSet = $derived(!!rt.shop.dates.from && !!rt.shop.dates.to);
  let form: HTMLFormElement | undefined = $state();
  const submit = () => form?.requestSubmit();
</script>

<div class="flex flex-col gap-6">
  <PageHead title={data.query ? rt.t('search.results_for', { query: data.query }) : rt.t('search.title')} />
  <form
    bind:this={form}
    method="GET"
    action={rt.url.search?.() ?? '/search'}
    class={[glass, 'relative -mt-4 flex flex-col gap-5 p-4 md:p-6']}
    role="search"
  >
    <InputGroup.Root class="h-12 rounded-full pl-1">
      <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
      <InputGroup.Input
        name="q"
        type="search"
        value={data.query}
        placeholder={rt.t('search.placeholder')}
        aria-label={rt.t('search.label')}
      />
      <InputGroup.Addon align="inline-end"
        ><InputGroup.Button type="submit" variant="default" class="h-9 rounded-full px-4">{rt.t('search.submit')}</InputGroup.Button
        ></InputGroup.Addon
      >
    </InputGroup.Root>
    <div class="flex flex-wrap items-end gap-4">
      <Field.Field class="w-auto">
        <Field.Label for="or-s-cat">{rt.t('search.category')}</Field.Label>
        <NativeSelect id="or-s-cat" name="category" value={data.category ?? ''} onchange={submit}>
          <NativeSelectOption value="">{rt.t('nav.all')}</NativeSelectOption>
          {#each rt.shop.categories as c (c.id)}<NativeSelectOption value={c.slug}
              >{c.name}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </Field.Field>
      <Field.Field class="w-auto">
        <Field.Label for="or-s-sort">{rt.t('search.sort')}</Field.Label>
        <NativeSelect id="or-s-sort" name="sort" value={data.sort} onchange={submit}>
          {#each ['relevance', 'name', 'newest'] as s (s)}<NativeSelectOption value={s}
              >{rt.t(`search.sort.${s}`)}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </Field.Field>
      {#if datesSet}
        <Field.Field orientation="horizontal" class="w-auto pb-2">
          <Switch
            id="or-s-free"
            name="available"
            value="1"
            checked={data.available}
            onCheckedChange={() => queueMicrotask(submit)}
          />
          <Field.Label for="or-s-free" class="font-normal">{rt.t('search.available')}</Field.Label>
        </Field.Field>
      {/if}
    </div>
  </form>
  <p class="text-sm text-white/60" role="status" data-testid="search-count">
    {rt.t('search.count', { count: data.products.length })}
  </p>
  {#if data.products.length}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3 xl:grid-cols-4">
      {#each data.products as p, i (p.id)}<div use:reveal={(i % 4) * 80}><ProductCard product={p} /></div>{/each}
    </div>
  {:else}
    <Empty.Root class={[glass, 'nf-dots py-16']}>
      <Empty.Header>
        <Empty.Media variant="icon" class="size-14 rounded-2xl bg-white/10 text-white"
          ><SearchXIcon class="size-7" /></Empty.Media
        >
        <Empty.Title class="text-xl font-semibold">{rt.t('search.empty')}</Empty.Title>
        <Empty.Description class="text-white/65">{rt.t('search.empty_hint')}</Empty.Description>
      </Empty.Header>
      <Empty.Content
        ><Button class="h-11 rounded-full px-6" href={rt.url.search?.() ?? '/search'} variant="outline">{rt.t('search.clear')}</Button
        ></Empty.Content
      >
    </Empty.Root>
  {/if}
</div>
