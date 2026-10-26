<script lang="ts">
  import { getRuntime, type Product } from '@openrent/theme-sdk';
  import * as Tabs from '@openrent/ui/tabs';
  import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
  import Table2Icon from '@lucide/svelte/icons/table-2';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import TagIcon from '@lucide/svelte/icons/tag';
  import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
  import TextIcon from '@lucide/svelte/icons/text';
  import ProductCard from './ProductCard.svelte';
  import Tag from './Tag.svelte';
  import Availability from './Availability.svelte';
  import { tagFor } from '../lib/concept.ts';
  import { facts } from '../lib/products.ts';

  /** Products as a database: a gallery of cards or a table, switched with view tabs. */
  let { products, title = '' }: { products: Product[]; title?: string } = $props();
  const rt = getRuntime();
  let view = $state('gallery');
  const VIEWS = [
    ['gallery', LayoutGridIcon],
    ['table', Table2Icon],
  ] as const;
  const dated = $derived(!!rt.shop.dates.from);
  const th =
    'text-muted-foreground h-8 border-r border-[#efeeec] px-2 text-left text-sm font-normal whitespace-nowrap last:border-r-0 [&_svg]:mr-1.5 [&_svg]:inline [&_svg]:size-4 [&_svg]:align-[-3px]';
  const td = 'h-9 border-r border-[#efeeec] px-2 align-middle text-sm last:border-r-0';
</script>

<Tabs.Root bind:value={view} class="gap-3">
  <div class="flex flex-wrap items-end justify-between gap-2 border-b border-[#efeeec]">
    {#if title}<h2 class="pb-1.5 text-base font-semibold">{title}</h2>{/if}
    <Tabs.List class="h-auto gap-1 rounded-none bg-transparent p-0">
      {#each VIEWS as [v, Icon] (v)}
        <Tabs.Trigger
          value={v}
          class="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-foreground h-8 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-1.5 pb-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          ><Icon />{rt.t(`view.${v}`)}</Tabs.Trigger
        >
      {/each}
    </Tabs.List>
  </div>
  <Tabs.Content value="gallery">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-4">
      {#each products as p (p.id)}<ProductCard product={p} />{/each}
    </div>
  </Tabs.Content>
  <Tabs.Content value="table">
    <div class="-mx-1 overflow-x-auto px-1">
      <table class="w-full min-w-[36rem] border-collapse" data-testid="product-table">
        <thead>
          <tr class="border-b border-[#efeeec]">
            <th class={th} scope="col"><TextIcon />{rt.t('props.name')}</th>
            <th class={th} scope="col"><TagIcon />{rt.t('props.price')}</th>
            {#if dated}<th class={th} scope="col"><CircleDotIcon />{rt.t('props.availability')}</th>{/if}
            <th class={th} scope="col"><TagIcon />{rt.t('props.categories')}</th>
          </tr>
        </thead>
        <tbody>
          {#each products as p (p.id)}
            {@const f = facts(p, rt.shop.categories)}
            <tr class="border-b border-[#efeeec] hover:bg-[#fbfbfa]">
              <td class={td}>
                <a class="flex items-center gap-2 font-medium" href={rt.url.product(p.slug)}>
                  {#if p.images[0]}<img
                      class="size-5 shrink-0 rounded-[3px] object-cover"
                      src={p.images[0].url_sm ?? p.images[0].url}
                      alt=""
                      loading="lazy"
                    />{:else}<FileTextIcon class="text-muted-foreground size-4 shrink-0" />{/if}
                  <span class="border-b border-[rgba(55,53,47,0.16)] leading-tight">{p.name}</span>
                </a>
              </td>
              <td class={[td, 'text-muted-foreground']}>{f.summary}</td>
              {#if dated}<td class={td}><Availability count={f.avail} /></td>{/if}
              <td class={td}
                ><span class="flex flex-wrap gap-1"
                  >{#each f.cats as c (c.id)}<Tag color={tagFor(c.slug)}>{c.name}</Tag>{/each}</span
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Tabs.Content>
</Tabs.Root>
