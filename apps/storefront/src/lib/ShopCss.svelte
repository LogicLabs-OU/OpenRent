<script lang="ts">
  /**
   * The shop's custom CSS, cleaned by the API on save (FR-SF-4). Rendered after the theme layout so
   * its rules come later in the head and win over the theme's at equal specificity.
   */
  let { css }: { css: string } = $props();
</script>

<svelte:head>
  {#if css}{@html `<style data-shop-css>${css.replace(/<\//g, '<\\/')}</style>`}{/if}
</svelte:head>
