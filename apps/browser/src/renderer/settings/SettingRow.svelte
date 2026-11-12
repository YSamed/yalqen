<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../ui/Icon.svelte';

  let {
    title,
    hint,
    detail,
    labelFor,
    stacked = false,
    children,
  }: {
    title: string;
    hint?: string;
    detail?: string;
    labelFor?: string;
    stacked?: boolean;
    children: Snippet;
  } = $props();
  const hintId = $props.id();
</script>

{#snippet text()}
  <span class="title">
    <span>{title}</span>
    {#if hint}
      <!-- The explanation stays in the label for screen readers and settings search; sighted users open it on demand. -->
      <!-- A click inside the row's label would otherwise toggle or focus its control. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
      <span class="info" tabindex="0" role="note" aria-describedby={hintId} onclick={(event) => event.preventDefault()}>
        <Icon name="info" size={14} />
        <span class="popover" id={hintId}>{hint}</span>
      </span>
    {/if}
  </span>
  {#if detail}<span class="hint">{detail}</span>{/if}
{/snippet}

<div class="row" class:stacked>
  {#if labelFor}
    <label for={labelFor} class="label">{@render text()}</label>
  {:else}
    <span class="label">{@render text()}</span>
  {/if}
  {@render children()}
</div>

<style>
  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .info {
    position: relative;
    display: inline-flex;
    color: var(--text-muted);
    border-radius: 50%;
    cursor: help;
  }

  .info:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 1px;
  }

  .popover {
    position: absolute;
    z-index: 10;
    top: calc(100% + 6px);
    left: -8px;
    width: max-content;
    max-width: 340px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-menu, var(--surface-strong));
    box-shadow: var(--page-shadow);
    color: var(--text);
    font-size: var(--font-size-small);
    line-height: 1.4;
    white-space: normal;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity var(--transition),
      visibility var(--transition);
  }

  .info:hover .popover,
  .info:focus-visible .popover {
    opacity: 1;
    visibility: visible;
  }

  @media (prefers-reduced-motion: reduce) {
    .popover {
      transition: none;
    }
  }
</style>
