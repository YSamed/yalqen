<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    hint,
    labelFor,
    stacked = false,
    children,
  }: { title: string; hint?: string; labelFor?: string; stacked?: boolean; children: Snippet } = $props();
</script>

{#snippet text()}
  <span>{title}</span>
  {#if hint}<span class="hint">{hint}</span>{/if}
{/snippet}

<div class="row" class:stacked>
  {#if labelFor}
    <label for={labelFor} class="label">{@render text()}</label>
  {:else}
    <span class="label">{@render text()}</span>
  {/if}
  {@render children()}
</div>
