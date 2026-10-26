<script lang="ts">
  import { getRuntime, type SearchData } from '@openrent/theme-sdk';
  import * as Empty from '@openrent/ui/empty';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Switch } from '@openrent/ui/switch';
  import { Button } from '@openrent/ui/button';
  import { Input } from '@openrent/ui/input';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ProductCard from '../snippets/ProductCard.svelte';
  import Coin from '../snippets/Coin.svelte';
  import { display, lift, pill, select, solid, wrap } from '../lib/retro.ts';
  import { cn } from '@openrent/ui/utils';

  /** Plain GET form: works before the page is interactive and keeps the URL shareable. */
  let { data }: { data: SearchData } = $props();
  const rt = getRuntime();
  const datesSet = $derived(!!rt.shop.dates.from && !!rt.shop.dates.to);
  let form: HTMLFormElement | undefined = $state();
  const submit = () => form?.requestSubmit();
  const link = (category: string | null) =>
    rt.url.search?.({ q: data.query, category, available: data.available, sort: data.sort }) ?? '/search';
</script>

<div class={[wrap, 'flex flex-col gap-8 py-12 md:py-16']}>
  <h1 class={display}>
    {data.query ? rt.t('search.results_for', { query: data.query }) : rt.t('search.title')}
  </h1>
  <form
    bind:this={form}
    method="GET"
    action={rt.url.search?.() ?? '/search'}
    class="flex flex-col gap-5"
    role="search"
  >
    <div class="flex items-stretch">
      <label class="relative flex-1">
        <span class="sr-only">{rt.t('search.label')}</span>
        <SearchIcon class="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" />
        <Input
          name="q"
          type="search"
          value={data.query}
          placeholder={rt.t('search.placeholder')}
          class="h-14 rounded-[0.25rem] rounded-r-none border-black bg-white pl-12 text-lg shadow-none"
        />
      </label>
      <Button type="submit" class={[solid, 'h-14 px-8 text-lg']}>{rt.t('search.submit')}</Button>
    </div>
    {#if data.category}<input type="hidden" name="category" value={data.category} />{/if}
    <div class="flex flex-wrap items-center gap-2" role="group" aria-label={rt.t('search.category')}>
      <Button
        href={link(null)}
        class={cn(pill, !data.category && 'bg-black text-white hover:bg-black hover:text-white')}
        aria-current={!data.category ? 'true' : undefined}>{rt.t('nav.all')}</Button
      >
      {#each rt.shop.categories as c (c.id)}
        {@const active = data.category === c.slug}
        <Button
          href={link(c.slug)}
          class={cn(pill, active && 'bg-black text-white hover:bg-black hover:text-white')}
          aria-current={active ? 'true' : undefined}>{c.name}</Button
        >
      {/each}
    </div>
    <div class="flex flex-wrap items-end gap-6">
      <Field.Field class="w-auto">
        <Field.Label for="or-s-sort" class="font-normal">{rt.t('search.sort')}</Field.Label>
        <NativeSelect
          id="or-s-sort"
          name="sort"
          value={data.sort}
          onchange={submit}
          class={['[&_select]:h-11 [&_select]:text-base', select]}
        >
          {#each ['relevance', 'name', 'newest'] as s (s)}<NativeSelectOption value={s}
              >{rt.t(`search.sort.${s}`)}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </Field.Field>
      {#if datesSet}
        <Field.Field orientation="horizontal" class="w-auto pb-2.5">
          <Switch
            id="or-s-free"
            name="available"
            value="1"
            checked={data.available}
            onCheckedChange={() => queueMicrotask(submit)}
            class="border-black data-[state=checked]:bg-black"
          />
          <Field.Label for="or-s-free" class="text-base font-normal">{rt.t('search.available')}</Field.Label>
        </Field.Field>
      {/if}
    </div>
  </form>
  <p class="text-lg" role="status" data-testid="search-count">
    {rt.t('search.count', { count: data.products.length })}
  </p>
  {#if data.products.length}
    <div class="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
      {#each data.products as p (p.id)}<ProductCard product={p} />{/each}
    </div>
  {:else}
    <Empty.Root class="gap-6 rounded-[0.25rem] border border-solid border-black bg-white">
      <Empty.Header class="gap-4">
        <Empty.Media><Coin letter="?" class="w-28 -rotate-12" /></Empty.Media>
        <Empty.Title class="text-2xl font-normal">{rt.t('search.empty')}</Empty.Title>
        <Empty.Description class="text-foreground text-base">{rt.t('search.empty_hint')}</Empty.Description>
      </Empty.Header>
      <Empty.Content
        ><Button href={rt.url.search?.() ?? '/search'} class={[solid, lift]}>{rt.t('search.clear')}</Button
        ></Empty.Content
      >
    </Empty.Root>
  {/if}
</div>
