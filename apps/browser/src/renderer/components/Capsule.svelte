<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    as = 'div',
    ariaLabel,
    minWidth,
    spread = false,
  }: {
    children: Snippet;
    as?: 'div' | 'nav';
    ariaLabel?: string;
    minWidth?: number;
    spread?: boolean;
  } = $props();
</script>

<svelte:element
  this={as}
  class="capsule"
  class:spread
  aria-label={ariaLabel}
  style:min-width={minWidth !== undefined ? `${minWidth}px` : null}
>
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

  .capsule.spread {
    justify-content: space-between;
  }

  :global([data-material='glass']) .capsule {
    box-shadow: var(--shadow), var(--rim);
  }
</style>
