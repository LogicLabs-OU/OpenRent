<script lang="ts">
	import { cn, type WithElementRef } from "#ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { setContext } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
	// Items inside a group are its list items (role="list" needs them).
	setContext("item-group", true);
</script>

<div
	bind:this={ref}
	role="list"
	data-slot="item-group"
	class={cn("gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2 group/item-group flex w-full flex-col", className)}
	{...restProps}
>
	{@render children?.()}
</div>
