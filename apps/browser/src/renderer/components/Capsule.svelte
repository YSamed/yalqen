<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    as = 'div',
    ariaLabel,
  }: {
    children: Snippet;
    as?: 'div' | 'nav';
    ariaLabel?: string;
  } = $props();
</script>

<svelte:element this={as} class="capsule" aria-label={ariaLabel}>
  {@render children()}
</svelte:element>

<style>
  .capsule {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: var(--chrome-control-size);
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
    -webkit-app-region: no-drag;
  }

  :global([data-material='glass']) .capsule {
    box-shadow: var(--shadow), var(--rim);
  }
</style>
