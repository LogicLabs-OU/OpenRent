<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '@openrent/ui/utils';
  import { col, title as titleClass } from '../lib/concept.ts';

  /**
   * The top of a page: an optional full-width cover (picture or soft gradient), a large emoji icon that
   * overlaps it, the title and a line of description. `children` sit under the title (properties, actions).
   */
  let {
    title,
    icon = '',
    cover = '',
    coverImage = '',
    description = '',
    width = '',
    children,
  }: {
    title: string;
    icon?: string;
    cover?: string;
    coverImage?: string;
    description?: string;
    width?: string;
    children?: Snippet;
  } = $props();
  const hasCover = $derived(!!(cover || coverImage));
</script>

<header class="mb-8">
  {#if hasCover}
    <div
      class="h-[30vh] max-h-[280px] min-h-[150px] w-full overflow-hidden"
      style:background={coverImage ? undefined : cover}
      data-testid="page-cover"
    >
      {#if coverImage}<img class="size-full object-cover" src={coverImage} alt="" />{/if}
    </div>
  {/if}
  <div class={cn(col, width, hasCover ? (icon ? '' : 'pt-10') : icon ? 'pt-12' : 'pt-14')}>
    {#if icon}<div
        class={['relative w-fit text-[4.5rem] leading-none select-none', hasCover && '-mt-10']}
        aria-hidden="true"
      >
        {icon}
      </div>{/if}
    <h1 class={[titleClass, icon && 'mt-5']}>{title}</h1>
    {#if description}<p
        class="text-muted-foreground mt-2 max-w-[65ch] text-base leading-7 text-pretty whitespace-pre-line"
      >
        {description}
      </p>{/if}
    {#if children}<div class="mt-5">{@render children()}</div>{/if}
  </div>
</header>
