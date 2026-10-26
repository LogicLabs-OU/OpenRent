<script lang="ts">
  import { getRuntime, type SearchData } from '@openrent/theme-sdk';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Switch } from '@openrent/ui/switch';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import ProductCard from '../snippets/ProductCard.svelte';
  import { h1 } from '../lib/marquee.ts';
  import { reveal } from '../lib/motion.ts';

  /** Plain GET form: works before the page is interactive and keeps the URL shareable. */
  let { data }: { data: SearchData } = $props();
  const rt = getRuntime();
  const datesSet = $derived(!!rt.shop.dates.from && !!rt.shop.dates.to);
  let form: HTMLFormElement | undefined = $state();
  const submit = () => form?.requestSubmit();
</script>

<div class="flex flex-col gap-6">
  <h1 class={[h1, 'break-words']}>
    {data.query ? rt.t('search.results_for', { query: data.query }) : rt.t('search.title')}
  </h1>
  <form bind:this={form} method="GET" action={rt.url.search?.() ?? '/search'} class="flex flex-col gap-4" role="search">
    <div class="flex items-stretch">
      <input
        class="mq-tight min-w-0 flex-1 border border-(--mq-ink) bg-white px-4 py-2 text-[clamp(2rem,5vw,4rem)] leading-none font-bold uppercase placeholder:text-[#6b6c73]"
        name="q"
        type="search"
        value={data.query}
        placeholder={rt.t('search.placeholder')}
        aria-label={rt.t('search.label')}
      />
      <button
        type="submit"
        class="mq-cta -ml-px grid aspect-square w-[clamp(3.5rem,7vw,5.25rem)] shrink-0 place-items-center"
        aria-label={rt.t('search.submit')}><SearchIcon class="size-7" aria-hidden="true" /></button
      >
    </div>
    <div class="flex flex-wrap items-end gap-4">
      <Field.Field class="w-auto">
        <Field.Label for="or-s-cat">{rt.t('search.category')}</Field.Label>
        <NativeSelect id="or-s-cat" name="category" class="[&_select]:h-11 [&_select]:uppercase" value={data.category ?? ''} onchange={submit}>
          <NativeSelectOption value="">{rt.t('nav.all')}</NativeSelectOption>
          {#each rt.shop.categories as c (c.id)}<NativeSelectOption value={c.slug}
              >{c.name}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </Field.Field>
      <Field.Field class="w-auto">
        <Field.Label for="or-s-sort">{rt.t('search.sort')}</Field.Label>
        <NativeSelect id="or-s-sort" name="sort" class="[&_select]:h-11 [&_select]:uppercase" value={data.sort} onchange={submit}>
          {#each ['relevance', 'name', 'newest'] as s (s)}<NativeSelectOption value={s}
              >{rt.t(`search.sort.${s}`)}</NativeSelectOption
            >{/each}
        </NativeSelect>
      </Field.Field>
      {#if datesSet}
        <Field.Field orientation="horizontal" class="w-auto pb-3">
          <Switch
            id="or-s-free"
            name="available"
            value="1"
            checked={data.available}
            onCheckedChange={() => queueMicrotask(submit)}
          />
          <Field.Label for="or-s-free">{rt.t('search.available')}</Field.Label>
        </Field.Field>
      {/if}
    </div>
  </form>
  <p class="mq-mono flex items-center gap-3 border-t border-(--mq-ink) pt-4 text-sm uppercase" role="status" data-testid="search-count">
    {rt.t('search.count', { count: data.products.length })}
  </p>
  {#if data.products.length}
    <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {#each data.products as p, i (p.id)}<div class="min-w-0" use:reveal={(i % 4) * 80}>
          <ProductCard product={p} />
        </div>{/each}
    </div>
  {:else}
    <div class="flex flex-col items-start gap-5 border border-(--mq-ink) p-8 md:p-12">
      <p class="mq-tight text-[clamp(2.25rem,5vw,4rem)] leading-[0.9] font-bold uppercase">{rt.t('search.empty')}</p>
      <p class="text-xl uppercase">{rt.t('search.empty_hint')}</p>
      <a class="mq-fill flex h-12 items-center gap-3 border border-(--mq-ink) px-5 text-lg font-bold uppercase" href={rt.url.search?.() ?? '/search'}
        >{rt.t('search.clear')}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></a
      >
    </div>
  {/if}
</div>
