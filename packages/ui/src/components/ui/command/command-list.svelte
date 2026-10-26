<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "#ui/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: CommandPrimitive.ListProps = $props();
</script>

<!-- The viewport gives the input its aria-controls target. -->
<CommandPrimitive.List
	bind:ref
	data-slot="command-list"
	class={cn("no-scrollbar max-h-72 scroll-py-1 outline-none overflow-x-hidden overflow-y-auto", className)}
	{...restProps}
>
	<CommandPrimitive.Viewport>{@render children?.()}</CommandPrimitive.Viewport>
</CommandPrimitive.List>
